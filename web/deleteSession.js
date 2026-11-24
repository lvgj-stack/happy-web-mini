// Deleting archived sessions (single and batch) and cleaning up any
// `.dev/worktree/*` checkouts they leave behind.
// Matches happy-server (`DELETE /v1/sessions/:id` in sessionDelete.ts) and the
// official apps (happy-ios `SessionInfoModel.keepsConversation` / `SessionActions.delete`,
// happy-android `SessionOps.delete`): bots and tasks keep one continuous conversation
// and cannot be deleted; a 404 means it is already gone.

import { WORKTREE_DIR, repoOf, worktreeOf } from './worktree.js';

const DAY_MS = 86_400_000;
const STORAGE_PREFIXES = ['happy.links.', 'happy.lines.', 'happy.model.', 'happy.effort.', 'happy.permission.'];
const trimSlash = (p) => String(p || '').trim().replace(/(.)\/+$/, '$1');
const machineKeyOf = (s) => s?.meta?.machineId || s?.meta?.host || 'unknown';
const archivedTime = (s) => s?.meta?.lifecycleStateSince || s?.updatedAt || 0;

/** Whether an archived session can be permanently deleted (regular chats only, never bots/tasks/side chats). */
export function canDeleteSession(s) {
    const m = s?.meta;
    if (!m || m.lifecycleState !== 'archived' || m.isSideChat === true) return false;
    if (m.bot && typeof m.bot === 'object') return false;
    if (m.task && typeof m.task === 'object') return false;
    return true;
}

/** Deletable archived sessions whose archive timestamp is at least `days` days old. */
export function archivedBefore(sessions, days, now = Date.now()) {
    const cutoff = now - days * DAY_MS;
    return sessions.filter((s) => canDeleteSession(s) && archivedTime(s) <= cutoff);
}

/**
 * `.dev/worktree/*` checkouts referenced by `targets` that no remaining session
 * (outside `targets`) still uses. Deduplicated by (machine, worktree path).
 */
export function orphanedWorktrees(targets, allSessions) {
    const removing = new Set(targets.map((s) => s.id));
    const kept = new Set();
    for (const s of allSessions) {
        if (removing.has(s.id) || s.meta?.isSideChat === true) continue;
        const wt = worktreeOf(trimSlash(s.meta?.path));
        if (wt) kept.add(`${machineKeyOf(s)}\u0000${wt}`);
    }
    const seen = new Set();
    const result = [];
    for (const s of targets) {
        const wt = worktreeOf(trimSlash(s.meta?.path));
        if (!wt) continue;
        const mKey = machineKeyOf(s);
        const key = `${mKey}\u0000${wt}`;
        if (kept.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push({
            machineId: s.meta?.machineId || null,
            machineKey: mKey,
            host: s.meta?.host || '',
            path: wt,
            repo: repoOf(wt),
            name: wt.split('/').pop(),
        });
    }
    return result;
}

/**
 * Check which candidate worktrees still exist on their computers.
 * Groups by `(machineId, repo)` so each repository is queried at most once.
 * `listFn(machine, repo)` resolves to `[{ path, branch }] | null`.
 */
export async function probeWorktrees(candidates, machines, listFn) {
    const byId = new Map((machines ?? []).map((m) => [m.id, m]));
    const existing = [];
    const missing = [];
    const offline = [];
    const failed = [];
    const groups = new Map();

    for (const c of candidates) {
        const m = c.machineId ? byId.get(c.machineId) : null;
        if (!m?.online) { offline.push(c); continue; }
        const key = `${m.id}\u0000${c.repo}`;
        if (!groups.has(key)) groups.set(key, { machine: m, repo: c.repo, items: [] });
        groups.get(key).items.push(c);
    }

    await Promise.all([...groups.values()].map(async ({ machine, repo, items }) => {
        let listed = null;
        try { listed = await listFn(machine, repo); } catch { listed = null; }
        if (!Array.isArray(listed)) { failed.push(...items); return; }
        for (const c of items) {
            const suffix = `/${WORKTREE_DIR}/${c.name}`;
            const hit = listed.find((w) => {
                const p = trimSlash(w.path);
                return p === c.path || (worktreeOf(p)?.endsWith(suffix) ?? false);
            });
            if (hit) existing.push({ ...c, machine, candidatePath: c.path, path: trimSlash(hit.path), branch: hit.branch });
            else missing.push(c);
        }
    }));

    return { existing, missing, offline, failed };
}

/**
 * Delete sessions on the server with bounded concurrency.
 * 404 means the session is already gone and counts as deleted (matching happy-ios).
 */
export async function deleteSessionsOnServer(sessions, deleteOne, { concurrency = 4, onProgress } = {}) {
    const total = sessions.length;
    const deleted = [];
    const failed = [];
    let next = 0;
    let done = 0;

    async function worker() {
        while (next < total) {
            const s = sessions[next++];
            try {
                await deleteOne(s);
                deleted.push(s);
            } catch (e) {
                if (e?.status === 404) deleted.push(s);
                else failed.push({ session: s, error: e?.message || String(e) });
            }
            done++;
            onProgress?.({ done, total, deleted: deleted.length, failed: failed.length });
        }
    }

    const workers = Math.max(1, Math.min(concurrency, total));
    await Promise.all(Array.from({ length: workers }, worker));
    return { deleted, failed };
}

/**
 * Remove confirmed worktrees sequentially so dirty-worktree confirmation prompts never overlap.
 * `removeFn(wt, { force })` wraps `removeWorktree`; `confirmDirty(wt)` asks whether to force-remove.
 */
export async function removeOrphanedWorktrees(worktrees, removeFn, confirmDirty) {
    const removed = [];
    const skippedDirty = [];
    const failed = [];
    for (const wt of worktrees) {
        try {
            let r;
            try {
                r = await removeFn(wt, { force: false });
            } catch (e) {
                if (!e?.dirty) throw e;
                if (!(await confirmDirty(wt))) { skippedDirty.push(wt); continue; }
                r = await removeFn(wt, { force: true });
            }
            removed.push({ ...wt, ...r });
        } catch (e) {
            failed.push({ ...wt, error: e?.message || String(e) });
        }
    }
    return { removed, skippedDirty, failed };
}

/** Remove all per-session cached entries from localStorage. */
export function clearSessionStorage(storage, ids) {
    for (const id of ids) {
        for (const prefix of STORAGE_PREFIXES) {
            try { storage.removeItem(prefix + id); } catch { /* ignore storage errors */ }
        }
    }
}

/** A one-line Chinese status message describing what was deleted and cleaned up. */
export function deleteSummary({ deletedCount, failedSessions = [], worktreeResult = null }) {
    const parts = [];
    if (deletedCount > 0) {
        let base = deletedCount === 1 && failedSessions.length === 0 ? '已删除会话' : `已删除 ${deletedCount} 个会话`;
        if (failedSessions.length) base += `（${failedSessions.length} 个失败）`;
        parts.push(base);
    } else if (failedSessions.length) {
        parts.push(failedSessions.length === 1
            ? `删除失败：${failedSessions[0].error}`
            : `删除失败（${failedSessions.length} 个）：${failedSessions[0].error}`);
    }

    if (worktreeResult) {
        const { removed = [], skippedDirty = [], failed = [] } = worktreeResult;
        if (removed.length === 1 && skippedDirty.length === 0 && failed.length === 0) {
            const w = removed[0];
            parts.push(`同时删除 worktree「${w.name}」` + (w.branchDeleted
                ? `和分支 ${w.branch}`
                : w.branch ? `（分支 ${w.branch} 还没合并，保留了）` : ''));
        } else {
            if (removed.length) parts.push(`清理 ${removed.length} 个 worktree`);
            if (skippedDirty.length) parts.push(`跳过 ${skippedDirty.length} 个含未提交改动的 worktree`);
            if (failed.length) parts.push(`${failed.length} 个 worktree 删除失败`);
        }
    }
    return parts.join('，');
}
