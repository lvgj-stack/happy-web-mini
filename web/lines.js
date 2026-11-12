// How many lines a session changed: added and removed lines summed over its
// file-editing tool calls, as their arguments describe them. Claude's Edit /
// MultiEdit / Write / NotebookEdit, Gemini's replace / write_file, Codex's
// CodexPatch (`changes`) and apply_patch (`patch`), and ACP diffs (Cursor:
// `items: [{ type: 'diff', oldText, newText }]`).
//
// What the arguments cannot tell is not counted: files changed from the shell
// (sed, scripts), what a Write replaced (all its lines count as added), and
// whether the call was later refused or failed. CodexDiff / GeminiDiff are
// not edits: the CLI sends them with the turn's diff so far, again and again.

const str = (v) => (typeof v === 'string' ? v : null);

/** Lines in a text; a trailing newline does not start one more. */
export function lineCount(text) {
    if (!text) return 0;
    const n = text.split('\n').length;
    return text.endsWith('\n') ? n - 1 : n;
}

const toLines = (text) => {
    if (!text) return [];
    const lines = text.split('\n');
    if (text.endsWith('\n')) lines.pop();
    return lines;
};

const LCS_CELLS = 4_000_000;

/** { add, del } between two texts, line by line (what `git diff --numstat` counts). */
export function diffLines(before, after) {
    const a = toLines(before ?? '');
    const b = toLines(after ?? '');
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const n = endA - start;
    const m = endB - start;
    if (!n || !m || n * m > LCS_CELLS) return { add: m, del: n };
    // Longest common subsequence of the middle, one row at a time.
    let prev = new Uint32Array(m + 1);
    let cur = new Uint32Array(m + 1);
    for (let i = 1; i <= n; i++) {
        const line = a[start + i - 1];
        for (let j = 1; j <= m; j++) {
            cur[j] = line === b[start + j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        [prev, cur] = [cur, prev];
    }
    const same = prev[m];
    return { add: m - same, del: n - same };
}

/**
 * { add, del } in a unified diff, or in apply_patch's own format
 * ("*** Update File: …" then "@@" hunks, "*** Add File: …" then "+" lines).
 * File headers ("--- a/x" / "+++ b/x", "*** …", "diff --git …") are not lines.
 */
export function countPatch(patch) {
    let add = 0;
    let del = 0;
    const lines = (patch ?? '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('*** ') || line.startsWith('diff --git ') || line.startsWith('\\ ')) continue;
        if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) { i++; continue; }
        if (line.startsWith('+')) add++;
        else if (line.startsWith('-')) del++;
    }
    return { add, del };
}

/** One Codex change entry (`changes[path]`, or an element of an array of them). */
function codexChange(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const type = str(entry.type) ?? str(entry.kind?.type) ?? str(entry.kind);
    const diff = str(entry.unified_diff) ?? str(entry.diff);
    if (diff) return countPatch(diff);
    if (entry.modify && typeof entry.modify === 'object') {
        return diffLines(str(entry.modify.old_content) ?? str(entry.modify.oldContent), str(entry.modify.new_content) ?? str(entry.modify.newContent));
    }
    const added = str(entry.add?.content) ?? (type === 'add' ? str(entry.content) : null);
    if (added !== null) return { add: lineCount(added), del: 0 };
    const removed = str(entry.delete?.content) ?? (type === 'delete' ? str(entry.content) : null);
    if (removed !== null) return { add: 0, del: lineCount(removed) };
    return null;
}

/** Files named by apply_patch's own format. */
function patchPaths(patch) {
    return [...(patch ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
}

const EDIT_TOOLS = new Set(['edit', 'replace', 'str_replace_editor', 'str_replace_based_edit_tool']);
const WRITE_TOOLS = new Set(['write', 'write_file', 'create']);

/**
 * The edits one tool call makes: [{ path, add, del }], empty when it changes no file.
 * `name` is the tool's name (any case), `args` its arguments.
 */
export function toolEdits(name, args) {
    const key = String(name ?? '').toLowerCase();
    if (!args || typeof args !== 'object') return [];
    const path = str(args.file_path) ?? str(args.path) ?? str(args.notebook_path) ?? str(args.filePath);
    const one = (counts) => (counts && (counts.add || counts.del) ? [{ path, ...counts }] : []);

    if (key === 'multiedit' && Array.isArray(args.edits)) {
        const total = { add: 0, del: 0 };
        for (const e of args.edits) {
            const d = diffLines(str(e?.old_string), str(e?.new_string));
            total.add += d.add;
            total.del += d.del;
        }
        return one(total);
    }
    if (key === 'str_replace_based_edit_tool' || key === 'str_replace_editor') {
        if (args.command === 'create') return one({ add: lineCount(str(args.file_text)), del: 0 });
        if (args.command === 'insert') return one({ add: lineCount(str(args.new_str) ?? str(args.insert_text)), del: 0 });
        if (args.command === 'str_replace') return one(diffLines(str(args.old_str), str(args.new_str)));
        return [];
    }
    if (EDIT_TOOLS.has(key) && (str(args.old_string) !== null || str(args.new_string) !== null)) {
        return one(diffLines(str(args.old_string), str(args.new_string)));
    }
    if (WRITE_TOOLS.has(key) && str(args.content) !== null) {
        return one({ add: lineCount(args.content), del: 0 });
    }
    if (key === 'notebookedit') {
        // The cell it replaces or deletes is not in the arguments.
        if (args.edit_mode === 'delete') return [];
        return one({ add: lineCount(str(args.new_source)), del: 0 });
    }
    if (key === 'apply_patch') {
        const patch = str(args.patch) ?? str(args.input);
        if (!patch) return [];
        const counts = countPatch(patch);
        if (!counts.add && !counts.del) return [];
        const files = patchPaths(patch);
        // The lines are not split per file: the first carries them, the rest are named.
        return (files.length ? files : [null]).map((p, i) => ({ path: p, ...(i ? { add: 0, del: 0 } : counts) }));
    }
    if (key.endsWith('patch') && args.changes && typeof args.changes === 'object') { // CodexPatch, GeminiPatch
        const entries = Array.isArray(args.changes)
            ? args.changes.map((c) => [str(c?.path), c])
            : Object.entries(args.changes);
        const out = [];
        for (const [p, entry] of entries) {
            const counts = codexChange(entry);
            if (counts && (counts.add || counts.del)) out.push({ path: p, ...counts });
        }
        return out;
    }
    // ACP tool calls (Cursor, OpenCode…): content blocks, some of them diffs.
    const blocks = Array.isArray(args.items) ? args.items : Array.isArray(args.content) ? args.content : null;
    if (blocks) {
        const out = [];
        for (const b of blocks) {
            if (b?.type !== 'diff') continue;
            const counts = diffLines(str(b.oldText) ?? str(b.old_text), str(b.newText) ?? str(b.new_text));
            if (counts.add || counts.del) out.push({ path: str(b.path), ...counts });
        }
        return out;
    }
    return [];
}

/**
 * The file-editing tool calls in one decrypted record: [{ call, name, args }].
 * Reads the session protocol (`tool-call-start`) and the older formats
 * (Claude's `output` with `tool_use` blocks, Codex's `tool-call`).
 */
export function toolCalls(raw) {
    const content = raw?.content;
    if (!content || typeof content !== 'object') return [];
    if (raw.role === 'session') {
        const env = content.type === 'session' ? content.data : content;
        const ev = env?.ev;
        if (ev?.t !== 'tool-call-start') return [];
        return [{ call: ev.call ?? null, name: ev.name, args: ev.args }];
    }
    if (raw.role !== 'agent') return [];
    if (content.type === 'output' && content.data?.type === 'assistant') {
        const blocks = content.data.message?.content;
        if (!Array.isArray(blocks)) return [];
        return blocks.filter((b) => b?.type === 'tool_use').map((b) => ({ call: b.id ?? null, name: b.name, args: b.input }));
    }
    if ((content.type === 'codex' || content.type === 'acp') && content.data?.type === 'tool-call') {
        const d = content.data;
        return [{ call: d.callId ?? d.id ?? null, name: d.name, args: d.input ?? d.args }];
    }
    return [];
}

/**
 * Running totals for one session. Each message is fed once (see syncLines);
 * a call id seen twice in this run still counts once.
 * `cached`: what toJSON() gave, to start from.
 */
export function lineStats(cached) {
    let add = Number.isFinite(cached?.add) ? cached.add : 0;
    let del = Number.isFinite(cached?.del) ? cached.del : 0;
    const files = new Set(Array.isArray(cached?.files) ? cached.files.filter((f) => typeof f === 'string') : []);
    const calls = new Set();
    return {
        /** Feed one decrypted record; true when the totals changed. */
        see(raw) {
            let changed = false;
            for (const { call, name, args } of toolCalls(raw)) {
                if (call) {
                    if (calls.has(call)) continue;
                    calls.add(call);
                }
                for (const e of toolEdits(name, args)) {
                    add += e.add;
                    del += e.del;
                    if (e.path) files.add(e.path);
                    changed = true;
                }
            }
            return changed;
        },
        get add() { return add; },
        get del() { return del; },
        get files() { return files.size; },
        toJSON() { return { add, del, files: [...files] }; },
    };
}

/** 1234 -> "1.2k", 12345 -> "12k". */
export function compactCount(n) {
    if (n < 1000) return String(n);
    if (n < 10000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`;
    return `${Math.floor(n / 1000)}k`;
}

export const LATEST = 2147483647; // before_seq=LATEST: the newest page

/**
 * Bring `stats` up to date with a session's messages: the newer ones past
 * what `cover` ({ from, to, complete }, or null at first) already holds,
 * then every older one back to the start. Every message with a seq in
 * [from, to] has been fed; `complete` means nothing older is left.
 * `fetchOlder(before)` gives the page just before seq `before` (LATEST: the
 * newest) and `fetchNewer(after)` the one just after, both as
 * { rows: [{ seq, raw }] in seq order, hasMore }. `target()` is the newest
 * seq the session is known to have; `save(cover)` runs after every page.
 * `pause()` true stops going further back for now (another session comes first).
 * Returns the cover reached; rejects when a page fails (what came before is saved).
 */
export async function syncLines({ stats, cover, target, fetchOlder, fetchNewer, save, alive = () => true, pause = () => false }) {
    const feed = (rows) => { for (const r of rows) stats.see(r.raw); };
    if (!cover) {
        const { rows, hasMore } = await fetchOlder(LATEST);
        if (!alive()) return null;
        feed(rows);
        const done = !hasMore || !rows.length;
        cover = { from: done ? 0 : rows[0].seq, to: rows.length ? rows.at(-1).seq : 0, complete: done };
        save(cover);
    }
    while (alive() && cover.to < target()) {
        const { rows, hasMore } = await fetchNewer(cover.to);
        if (!alive()) return cover;
        if (!rows.length) break;
        feed(rows);
        cover = { ...cover, to: Math.max(cover.to, rows.at(-1).seq) };
        save(cover);
        if (!hasMore) break;
    }
    while (alive() && !cover.complete && !pause()) {
        const { rows, hasMore } = await fetchOlder(cover.from);
        if (!alive()) return cover;
        feed(rows);
        const done = !hasMore || !rows.length;
        cover = { ...cover, from: done ? 0 : rows[0].seq, complete: done };
        save(cover);
    }
    return cover;
}
