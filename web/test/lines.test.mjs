// node --test: how many lines a session changed, from its tool calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LATEST, compactCount, countPatch, diffLines, lineCount, lineStats, syncLines, toolCalls, toolEdits } from '../lines.js';

test('lineCount: a trailing newline does not add a line', () => {
    assert.equal(lineCount(''), 0);
    assert.equal(lineCount(null), 0);
    assert.equal(lineCount('a'), 1);
    assert.equal(lineCount('a\nb\n'), 2);
    assert.equal(lineCount('\n'), 1);
});

test('diffLines: counts like git, common lines are not changes', () => {
    assert.deepEqual(diffLines('foo', 'bar'), { add: 1, del: 1 });
    assert.deepEqual(diffLines('a\nb', 'a\nx\nb'), { add: 1, del: 0 });
    assert.deepEqual(diffLines('a\nb\nc', 'a\nc'), { add: 0, del: 1 });
    assert.deepEqual(diffLines('a\nb\nc\nd', 'x\nb\ny\nd'), { add: 2, del: 2 });
    assert.deepEqual(diffLines('', 'a\nb'), { add: 2, del: 0 });
    assert.deepEqual(diffLines('same', 'same'), { add: 0, del: 0 });
    // Moved block: LCS keeps the longer run.
    assert.deepEqual(diffLines('1\n2\n3\nm', 'm\n1\n2\n3'), { add: 1, del: 1 });
});

test('countPatch: unified diffs and apply_patch, headers are not lines', () => {
    const unified = 'diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n+more\n\\ No newline at end of file';
    assert.deepEqual(countPatch(unified), { add: 2, del: 1 });
    const patch = '*** Begin Patch\n*** Add File: a.txt\n+one\n+two\n*** Update File: b.txt\n@@ fn\n keep\n-gone\n+here\n*** End Patch';
    assert.deepEqual(countPatch(patch), { add: 3, del: 1 });
});

test('toolEdits: Claude tools', () => {
    assert.deepEqual(toolEdits('Edit', { file_path: '/r/a.js', old_string: 'x = 1', new_string: 'x = 2\ny = 3' }), [{ path: '/r/a.js', add: 2, del: 1 }]);
    assert.deepEqual(toolEdits('MultiEdit', { file_path: '/r/a.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c\nd', new_string: '' }] }),
        [{ path: '/r/a.js', add: 1, del: 3 }]);
    assert.deepEqual(toolEdits('Write', { file_path: '/r/new.md', content: '# T\n\nbody\n' }), [{ path: '/r/new.md', add: 3, del: 0 }]);
    assert.deepEqual(toolEdits('NotebookEdit', { notebook_path: '/r/n.ipynb', new_source: 'a\nb', edit_mode: 'insert' }), [{ path: '/r/n.ipynb', add: 2, del: 0 }]);
    assert.deepEqual(toolEdits('NotebookEdit', { notebook_path: '/r/n.ipynb', edit_mode: 'delete' }), []);
    assert.deepEqual(toolEdits('Edit', { file_path: '/r/a.js', old_string: 'same', new_string: 'same' }), [], 'no change, no entry');
    assert.deepEqual(toolEdits('Read', { file_path: '/r/a.js' }), []);
    assert.deepEqual(toolEdits('Bash', { command: 'sed -i s/a/b/ x' }), []);
});

test('toolEdits: the CLI\'s running turn diffs are not edits', () => {
    assert.deepEqual(toolEdits('CodexDiff', { unified_diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b' }), []);
    assert.deepEqual(toolEdits('GeminiDiff', { unified_diff: '@@ -1 +1 @@\n-a\n+b', path: 'x' }), []);
    assert.deepEqual(toolEdits('McpTool', { changes: { x: { type: 'add', content: 'a' } } }), [], 'changes only from a patch tool');
    assert.deepEqual(toolEdits('GeminiPatch', { changes: { x: { type: 'add', content: 'a' } } }), [{ path: 'x', add: 1, del: 0 }]);
});

test('toolEdits: Gemini and the str_replace tool', () => {
    assert.deepEqual(toolEdits('replace', { file_path: 'f', old_string: 'a', new_string: 'b' }), [{ path: 'f', add: 1, del: 1 }]);
    assert.deepEqual(toolEdits('write_file', { file_path: 'f', content: 'a\nb' }), [{ path: 'f', add: 2, del: 0 }]);
    assert.deepEqual(toolEdits('str_replace_based_edit_tool', { command: 'create', path: 'f', file_text: 'a' }), [{ path: 'f', add: 1, del: 0 }]);
    assert.deepEqual(toolEdits('str_replace_based_edit_tool', { command: 'view', path: 'f' }), []);
});

test('toolEdits: Codex CodexPatch changes, every shape the CLI forwards', () => {
    const changes = {
        '/r/new.txt': { type: 'add', content: 'a\nb\n' },
        '/r/gone.txt': { type: 'delete', content: 'x\n' },
        '/r/mod.txt': { type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new\n', move_path: null },
        '/r/app.txt': { kind: { type: 'update', move_path: null }, diff: '@@ -1 +1,2 @@\n a\n+b\n' },
        '/r/m2.txt': { modify: { old_content: 'a\nb', new_content: 'a\nc' } },
        '/r/a2.txt': { kind: { type: 'add' }, add: { content: 'z' } },
    };
    assert.deepEqual(toolEdits('CodexPatch', { auto_approved: true, changes }), [
        { path: '/r/new.txt', add: 2, del: 0 },
        { path: '/r/gone.txt', add: 0, del: 1 },
        { path: '/r/mod.txt', add: 1, del: 1 },
        { path: '/r/app.txt', add: 1, del: 0 },
        { path: '/r/m2.txt', add: 1, del: 1 },
        { path: '/r/a2.txt', add: 1, del: 0 },
    ]);
    // The app server's array form.
    assert.deepEqual(toolEdits('CodexPatch', { changes: [{ path: '/r/x', kind: { type: 'update' }, diff: '@@\n-a\n+b\n+c' }], status: 'completed' }),
        [{ path: '/r/x', add: 2, del: 1 }]);
});

test('toolEdits: apply_patch names every file, lines go on the first', () => {
    const patch = '*** Begin Patch\n*** Add File: a.txt\n+one\n*** Update File: b.txt\n@@\n-x\n+y\n*** End Patch';
    assert.deepEqual(toolEdits('apply_patch', { input: patch }), [
        { path: 'a.txt', add: 2, del: 1 },
        { path: 'b.txt', add: 0, del: 0 },
    ]);
});

test('toolEdits: ACP diff blocks (Cursor)', () => {
    const args = { items: [{ type: 'content', content: { type: 'text', text: 'hi' } }, { type: 'diff', path: '/r/a.ts', oldText: 'a\nb', newText: 'a\nc\nd' }, { type: 'diff', path: '/r/n.ts', oldText: null, newText: 'x' }] };
    assert.deepEqual(toolEdits('edit', args), [{ path: '/r/a.ts', add: 2, del: 1 }, { path: '/r/n.ts', add: 1, del: 0 }]);
});

test('toolCalls: session protocol and the older formats', () => {
    const session = { role: 'session', content: { type: 'session', data: { role: 'agent', ev: { t: 'tool-call-start', call: 'c1', name: 'Edit', args: { a: 1 } } } } };
    assert.deepEqual(toolCalls(session), [{ call: 'c1', name: 'Edit', args: { a: 1 } }]);
    const text = { role: 'session', content: { type: 'session', data: { role: 'agent', ev: { t: 'text', text: 'hi' } } } };
    assert.deepEqual(toolCalls(text), []);
    const legacy = { role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 't1', name: 'Write', input: { content: 'a' } }] } } } };
    assert.deepEqual(toolCalls(legacy), [{ call: 't1', name: 'Write', args: { content: 'a' } }]);
    const codex = { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'k', name: 'CodexPatch', input: { changes: {} } } } };
    assert.deepEqual(toolCalls(codex), [{ call: 'k', name: 'CodexPatch', args: { changes: {} } }]);
    assert.deepEqual(toolCalls(null), []);
    assert.deepEqual(toolCalls({ role: 'user', content: { type: 'text', text: 'x' } }), []);
});

const edit = (call, old_string, new_string, path = '/r/a') => ({
    role: 'session', content: { type: 'session', data: { role: 'agent', ev: { t: 'tool-call-start', call, name: 'Edit', args: { file_path: path, old_string, new_string } } } },
});

test('lineStats: sums, counts files, a call id counts once, round-trips', () => {
    const stats = lineStats();
    assert.equal(stats.see(edit('c1', 'a', 'b')), true);
    assert.equal(stats.see(edit('c1', 'a', 'b')), false, 'same call again');
    stats.see(edit('c2', '', 'x\ny', '/r/b'));
    assert.equal(stats.see({ role: 'user', content: { type: 'text', text: 'hi' } }), false);
    assert.deepEqual([stats.add, stats.del, stats.files], [3, 1, 2]);
    const again = lineStats(JSON.parse(JSON.stringify(stats)));
    again.see(edit('c3', 'q', 'r'));
    assert.deepEqual([again.add, again.del, again.files], [4, 2, 2]);
    assert.deepEqual([lineStats({ add: 'x' }).add, lineStats(null).files], [0, 0], 'bad cache starts over');
});

test('compactCount', () => {
    assert.deepEqual([0, 999, 1000, 1234, 9999, 12345].map(compactCount), ['0', '999', '1k', '1.2k', '9.9k', '12k']);
});

/** A fake server: messages seq 1..n, each an edit adding one line. */
function server(n, page = 3) {
    const all = Array.from({ length: n }, (_, i) => ({ seq: i + 1, raw: edit(`c${i + 1}`, '', `l${i + 1}`) }));
    const calls = [];
    return {
        all, calls,
        fetchOlder: async (before) => {
            calls.push(['older', before]);
            const older = all.filter((m) => m.seq < before);
            return { rows: older.slice(-page), hasMore: older.length > page };
        },
        fetchNewer: async (after) => {
            calls.push(['newer', after]);
            const newer = all.filter((m) => m.seq > after);
            return { rows: newer.slice(0, page), hasMore: newer.length > page };
        },
    };
}

test('syncLines: from nothing, newest page first, then back to the start', async () => {
    const srv = server(7);
    const stats = lineStats();
    const saves = [];
    const cover = await syncLines({ stats, cover: null, target: () => 7, ...srv, save: (c) => saves.push(c) });
    assert.deepEqual(cover, { from: 0, to: 7, complete: true });
    assert.equal(stats.add, 7);
    assert.deepEqual(srv.calls, [['older', LATEST], ['older', 5], ['older', 2]]);
    assert.deepEqual(saves.at(0), { from: 5, to: 7, complete: false });
});

test('syncLines: a cached cover only fetches what is newer', async () => {
    const srv = server(10);
    const stats = lineStats({ add: 6, del: 0, files: ['/r/a'] });
    const cover = await syncLines({ stats, cover: { from: 0, to: 6, complete: true }, target: () => 10, ...srv, save() {} });
    assert.deepEqual(cover, { from: 0, to: 10, complete: true });
    assert.equal(stats.add, 10);
    assert.deepEqual(srv.calls, [['newer', 6], ['newer', 9]]);
});

test('syncLines: an empty session is complete at once', async () => {
    const srv = server(0);
    const cover = await syncLines({ stats: lineStats(), cover: null, target: () => 0, ...srv, save() {} });
    assert.deepEqual(cover, { from: 0, to: 0, complete: true });
});

test('syncLines: a failed page keeps what was saved before it', async () => {
    const srv = server(9);
    const saves = [];
    let n = 0;
    const fetchOlder = async (before) => { if (++n === 2) throw new Error('offline'); return srv.fetchOlder(before); };
    await assert.rejects(syncLines({ stats: lineStats(), cover: null, target: () => 9, fetchOlder, fetchNewer: srv.fetchNewer, save: (c) => saves.push(c) }));
    assert.deepEqual(saves, [{ from: 7, to: 9, complete: false }]);
});

test('syncLines: pause leaves older pages for later, a second run finishes', async () => {
    const srv = server(9);
    const stats = lineStats();
    let cover = await syncLines({ stats, cover: null, target: () => 9, ...srv, save() {}, pause: () => true });
    assert.deepEqual(cover, { from: 7, to: 9, complete: false });
    cover = await syncLines({ stats, cover, target: () => 9, ...srv, save() {} });
    assert.deepEqual(cover, { from: 0, to: 9, complete: true });
    assert.equal(stats.add, 9);
});

test('syncLines: stops when no longer alive', async () => {
    const srv = server(9);
    let alive = true;
    const fetchOlder = async (before) => { const r = await srv.fetchOlder(before); alive = false; return r; };
    const cover = await syncLines({ stats: lineStats(), cover: null, target: () => 9, fetchOlder, fetchNewer: srv.fetchNewer, save() {}, alive: () => alive });
    assert.equal(cover, null);
});
