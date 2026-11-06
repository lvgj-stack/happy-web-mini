// node --test: telling which background tasks are still running.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backgroundStart, backgroundStops, backgroundText } from '../background.js';

const note = (id, status = 'completed') => `<task-notification>
<task-id>a31224babb24deed1</task-id>
<tool-use-id>${id}</tool-use-id>
<status>${status}</status>
<summary>Agent "Reviewer" finished</summary>
</task-notification>`;

test('a tool call run in the background starts a task, named by its description', () => {
    const view = { kind: 'tool', call: 'toolu_1', name: 'Agent', title: 'Agent', args: { description: 'Reviewer：集中审查', run_in_background: true } };
    assert.deepEqual(backgroundStart(view), { call: 'toolu_1', label: 'Reviewer：集中审查' });
    const bash = { kind: 'tool', call: 'toolu_2', name: 'Bash', args: { command: 'npm test', run_in_background: true } };
    assert.deepEqual(backgroundStart(bash), { call: 'toolu_2', label: 'npm test' });
});

test('foreground calls and other messages start nothing', () => {
    assert.equal(backgroundStart({ kind: 'tool', call: 'x', name: 'Agent', args: { description: 'd' } }), null);
    assert.equal(backgroundStart({ kind: 'tool', call: 'x', name: 'Bash', args: { run_in_background: 'true' } }), null);
    assert.equal(backgroundStart({ kind: 'agent', text: 'hi' }), null);
    assert.equal(backgroundStart(null), null);
});

test('a task notification stops the call it names', () => {
    assert.deepEqual(backgroundStops(note('toolu_1')), ['toolu_1']);
    assert.deepEqual(backgroundStops(`  ${note('toolu_1')}\n${note('toolu_2', 'failed')}\n接着做`), ['toolu_1', 'toolu_2']);
});

test('ordinary text, inline mentions and unfinished wrappers stop nothing', () => {
    assert.deepEqual(backgroundStops('hello'), []);
    assert.deepEqual(backgroundStops('see <task-notification><tool-use-id>x</tool-use-id></task-notification>'), []);
    assert.deepEqual(backgroundStops('<task-notification><tool-use-id>x</tool-use-id>'), []);
    assert.deepEqual(backgroundStops(`${note('a')}\n<tool-use-id>quoted</tool-use-id>`), ['a']);
    assert.deepEqual(backgroundStops(undefined), []);
});

test('the status line names the newest and counts the rest', () => {
    assert.equal(backgroundText([]), '');
    assert.equal(backgroundText(['A']), '后台运行中：A');
    assert.equal(backgroundText(['A', 'B', 'C']), '后台运行中：C 等 3 个');
});
