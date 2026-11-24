// node --test: deleting archived sessions, batch filters, orphaned worktrees and storage cleanup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    archivedBefore,
    canDeleteSession,
    clearSessionStorage,
    deleteSessionsOnServer,
    deleteSummary,
    orphanedWorktrees,
    probeWorktrees,
    removeOrphanedWorktrees,
} from '../deleteSession.js';

const DAY = 86_400_000;
const session = (id, meta = {}, extra = {}) => ({
    id, active: false, updatedAt: 0,
    meta: { lifecycleState: 'archived', machineId: 'm1', host: 'mac', path: '/repo', ...meta },
    ...extra,
});

test('only archived regular chats can be deleted; live, bots, tasks and side chats cannot', () => {
    assert.equal(canDeleteSession(session('a')), true);
    assert.equal(canDeleteSession(session('b', { lifecycleState: 'active' }, { active: true })), false);
    assert.equal(canDeleteSession(session('c', { lifecycleState: undefined })), false);
    assert.equal(canDeleteSession(session('d', { bot: { name: 'Bot' } })), false);
    assert.equal(canDeleteSession(session('e', { task: { name: 'Task' } })), false);
    assert.equal(canDeleteSession(session('f', { isSideChat: true })), false);
    assert.equal(canDeleteSession(null), false);
});

test('archivedBefore picks deletable archived sessions at or past the age cutoff', () => {
    const now = 100 * DAY;
    const list = [
        session('recent', { lifecycleStateSince: now - 2 * DAY }),
        session('week', { lifecycleStateSince: now - 7 * DAY }),
        session('month', { lifecycleStateSince: now - 35 * DAY }),
        session('fallback', { lifecycleStateSince: 0 }, { updatedAt: now - 10 * DAY }),
        session('bot-old', { lifecycleStateSince: now - 40 * DAY, bot: {} }),
        session('live-old', { lifecycleState: 'active', lifecycleStateSince: now - 40 * DAY }),
    ];
    assert.deepEqual(archivedBefore(list, 7, now).map((s) => s.id), ['week', 'month', 'fallback']);
    assert.deepEqual(archivedBefore(list, 30, now).map((s) => s.id), ['month']);
});

test('orphanedWorktrees finds checkouts with no remaining session and deduplicates across targets', () => {
    const wtA = '/repo/.dev/worktree/swift-desert';
    const wtB = '/repo/.dev/worktree/calm-river';
    const wtShared = '/repo/.dev/worktree/shared-hill';
    const all = [
        session('a1', { path: wtA }),
        session('a2', { path: `${wtA}/sub` }), // same worktree via subdirectory
        session('b1', { path: wtB }),
        session('s1', { path: wtShared }),
        session('s2', { path: wtShared }), // still kept unless also in targets
        session('main', { path: '/repo' }),
        session('other-host', { machineId: 'm2', host: 'linux', path: wtB }), // different machine, same path
    ];

    // Deleting a1 alone leaves a2 in wtA -> not orphaned yet
    assert.deepEqual(orphanedWorktrees([all[0]], all), []);

    // Deleting a1 + a2 + b1 + s1 + main -> wtA and wtB (on m1) are orphaned; wtShared is kept by s2
    const got = orphanedWorktrees([all[0], all[1], all[2], all[3], all[5]], all);
    assert.deepEqual(got, [
        { machineId: 'm1', machineKey: 'm1', host: 'mac', path: wtA, repo: '/repo', name: 'swift-desert' },
        { machineId: 'm1', machineKey: 'm1', host: 'mac', path: wtB, repo: '/repo', name: 'calm-river' },
    ]);

    // Deleting s1 + s2 together makes wtShared orphaned too
    assert.deepEqual(orphanedWorktrees([all[3], all[4]], all).map((w) => w.name), ['shared-hill']);
});

test('probeWorktrees queries each (machine, repo) once and splits existing, missing, offline and failed', async () => {
    const candidates = [
        { machineId: 'm1', machineKey: 'm1', host: 'mac', path: '/var/repo/.dev/worktree/alive', repo: '/var/repo', name: 'alive' },
        { machineId: 'm1', machineKey: 'm1', host: 'mac', path: '/var/repo/.dev/worktree/gone', repo: '/var/repo', name: 'gone' },
        { machineId: 'm2', machineKey: 'm2', host: 'off', path: '/repo/.dev/worktree/sleep', repo: '/repo', name: 'sleep' },
        { machineId: 'm1', machineKey: 'm1', host: 'mac', path: '/broken/.dev/worktree/err', repo: '/broken', name: 'err' },
    ];
    const machines = [{ id: 'm1', online: true }, { id: 'm2', online: false }];
    const calls = [];
    const listFn = async (m, repo) => {
        calls.push([m.id, repo]);
        if (repo === '/broken') return null;
        // Simulate macOS /private/var symlink resolution on git's output.
        return [{ path: '/private/var/repo/.dev/worktree/alive', branch: 'alive' }];
    };

    const res = await probeWorktrees(candidates, machines, listFn);
    assert.deepEqual(calls, [['m1', '/var/repo'], ['m1', '/broken']]);
    assert.equal(res.existing.length, 1);
    assert.equal(res.existing[0].candidatePath, '/var/repo/.dev/worktree/alive');
    assert.equal(res.existing[0].path, '/private/var/repo/.dev/worktree/alive');
    assert.equal(res.existing[0].branch, 'alive');
    assert.deepEqual(res.missing.map((w) => w.name), ['gone']);
    assert.deepEqual(res.offline.map((w) => w.name), ['sleep']);
    assert.deepEqual(res.failed.map((w) => w.name), ['err']);
});

test('deleteSessionsOnServer respects concurrency, treats 404 as deleted, and reports progress', async () => {
    const items = [session('s1'), session('s2'), session('s3'), session('s4'), session('s5')];
    let inFlight = 0;
    let peak = 0;
    const progress = [];
    const res = await deleteSessionsOnServer(items, async (s) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        if (s.id === 's2') { const e = new Error('服务器返回 404'); e.status = 404; throw e; }
        if (s.id === 's4') { const e = new Error('服务器返回 500'); e.status = 500; throw e; }
    }, { concurrency: 2, onProgress: (p) => progress.push(p) });

    assert.equal(peak, 2);
    assert.deepEqual(res.deleted.map((s) => s.id), ['s1', 's2', 's3', 's5']);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].session.id, 's4');
    assert.equal(progress.at(-1).done, 5);
    assert.equal(progress.at(-1).total, 5);
});

test('removeOrphanedWorktrees handles clean, dirty-confirmed, dirty-skipped and errors sequentially', async () => {
    const list = [
        { name: 'clean', path: '/r/.dev/worktree/clean' },
        { name: 'dirty-ok', path: '/r/.dev/worktree/dirty-ok' },
        { name: 'dirty-skip', path: '/r/.dev/worktree/dirty-skip' },
        { name: 'boom', path: '/r/.dev/worktree/boom' },
    ];
    const asked = [];
    const res = await removeOrphanedWorktrees(list, async (wt, { force }) => {
        if (wt.name === 'clean') return { branch: 'clean', branchDeleted: true, branchError: '' };
        if (wt.name === 'dirty-ok' && !force) { const e = new Error('dirty'); e.dirty = true; throw e; }
        if (wt.name === 'dirty-ok' && force) return { branch: 'dirty-ok', branchDeleted: false, branchError: 'unmerged' };
        if (wt.name === 'dirty-skip' && !force) { const e = new Error('dirty'); e.dirty = true; throw e; }
        throw new Error('permission denied');
    }, async (wt) => {
        asked.push(wt.name);
        return wt.name === 'dirty-ok';
    });

    assert.deepEqual(asked, ['dirty-ok', 'dirty-skip']);
    assert.deepEqual(res.removed.map((w) => w.name), ['clean', 'dirty-ok']);
    assert.deepEqual(res.skippedDirty.map((w) => w.name), ['dirty-skip']);
    assert.deepEqual(res.failed.map((w) => w.name), ['boom']);
});

test('clearSessionStorage removes all per-session browser keys without touching others', () => {
    const map = new Map([
        ['happy.links.s1', '1'],
        ['happy.lines.s1', '2'],
        ['happy.model.s1', 'claude'],
        ['happy.effort.s1', 'high'],
        ['happy.permission.s1', 'default'],
        ['happy.links.s2', 'keep'],
        ['happy.token', 'secret'],
    ]);
    const storage = { removeItem: (k) => map.delete(k) };
    clearSessionStorage(storage, ['s1']);
    assert.deepEqual([...map.keys()], ['happy.links.s2', 'happy.token']);
});

test('deleteSummary formats single, batch, partial failure and worktree results', () => {
    assert.equal(deleteSummary({ deletedCount: 1, failedSessions: [] }), '已删除会话');
    assert.equal(deleteSummary({ deletedCount: 3, failedSessions: [] }), '已删除 3 个会话');
    assert.equal(deleteSummary({
        deletedCount: 1, failedSessions: [],
        worktreeResult: { removed: [{ name: 'swift-desert', branch: 'swift-desert', branchDeleted: true }], skippedDirty: [], failed: [] },
    }), '已删除会话，同时删除 worktree「swift-desert」和分支 swift-desert');
    assert.equal(deleteSummary({
        deletedCount: 1, failedSessions: [],
        worktreeResult: { removed: [{ name: 'swift-desert', branch: 'swift-desert', branchDeleted: false }], skippedDirty: [], failed: [] },
    }), '已删除会话，同时删除 worktree「swift-desert」（分支 swift-desert 还没合并，保留了）');
    assert.equal(deleteSummary({
        deletedCount: 5, failedSessions: [{ session: { id: 'x' }, error: '500' }],
        worktreeResult: { removed: [{ name: 'a' }, { name: 'b' }], skippedDirty: [{ name: 'c' }], failed: [] },
    }), '已删除 5 个会话（1 个失败），清理 2 个 worktree，跳过 1 个含未提交改动的 worktree');
});
