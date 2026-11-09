// node --test: telling which background tasks are still running.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backgroundTracker, backgroundStops, backgroundText } from '../background.js';

const note = (toolUseId, taskId = 'a31224babb24deed1', status = 'completed') => `<task-notification>
<task-id>${taskId}</task-id>
<tool-use-id>${toolUseId}</tool-use-id>
<status>${status}</status>
<summary>Agent "Reviewer" finished</summary>
</task-notification>`;

const agent = (call, args) => ({ kind: 'tool', call, name: 'Agent', title: 'Agent', args: { run_in_background: true, ...args } });
const send = (call, args) => ({ kind: 'tool', call, name: 'SendMessage', title: 'SendMessage', args });
const stops = (text) => ({ kind: 'stops', stops: backgroundStops(text) });

/** A tracker fed in order, numbering messages as they come. */
function inOrder() {
    const t = backgroundTracker();
    let seq = 0;
    return { see: (view) => t.see(view, ++seq), labels: () => t.labels(), clear: () => t.clear() };
}

test('a tool call run in the background runs until its notification', () => {
    const t = inOrder();
    t.see(agent('toolu_1', { description: 'Reviewer：集中审查' }));
    t.see({ kind: 'tool', call: 'toolu_2', name: 'Bash', args: { command: 'npm test', run_in_background: true } });
    assert.deepEqual(t.labels(), ['Reviewer：集中审查', 'npm test']);
    t.see(stops(note('toolu_1')));
    assert.deepEqual(t.labels(), ['npm test']);
    t.see(stops(note('toolu_2', 'bx1')));
    assert.deepEqual(t.labels(), []);
});

test('foreground calls and other messages start nothing', () => {
    const t = inOrder();
    t.see({ kind: 'tool', call: 'x', name: 'Agent', args: { description: 'd' } });
    t.see({ kind: 'tool', call: 'y', name: 'Bash', args: { run_in_background: 'true' } });
    t.see({ kind: 'agent', text: 'hi' });
    t.see(null);
    assert.deepEqual(t.labels(), []);
});

test('SendMessage to a stopped agent, by its agentId, runs it again', () => {
    const t = inOrder();
    t.see(agent('toolu_dev', { description: 'Dev：实现字段' }));
    t.see(stops(note('toolu_dev', 'adev')));
    assert.deepEqual(t.labels(), []);
    t.see(send('toolu_s1', { to: 'adev', summary: '补 console 校验', message: '…' }));
    assert.deepEqual(t.labels(), ['Dev：实现字段 · 补 console 校验']);
    // Its next stop may carry the SendMessage call's id …
    t.see(stops(note('toolu_s1', 'adev')));
    assert.deepEqual(t.labels(), []);
    // … or the first call's.
    t.see(send('toolu_s2', { to: 'adev', message: 'again' }));
    assert.deepEqual(t.labels(), ['Dev：实现字段']);
    t.see(stops(note('toolu_dev', 'adev')));
    assert.deepEqual(t.labels(), []);
});

test('SendMessage by the name given at launch, before any notification', () => {
    const t = inOrder();
    t.see(agent('toolu_dev', { name: 'Dev', description: '实现字段' }));
    t.see(send('toolu_s1', { to: 'Dev', summary: '再补一个', message: '…' }));
    assert.deepEqual(t.labels(), ['Dev · 再补一个'], 'one agent, shown once');
    t.see(stops(note('toolu_dev', 'adev')));
    assert.deepEqual(t.labels(), []);
    t.see(send('toolu_s2', { to: 'adev', message: '…' }));
    assert.deepEqual(t.labels(), ['Dev']);
});

test('SendMessage to someone unknown ("main", a teammate) shows nothing', () => {
    const t = inOrder();
    t.see(send('toolu_s', { to: 'main', message: 'hi' }));
    t.see(send('toolu_t', { to: 'researcher', message: 'hi' }));
    assert.deepEqual(t.labels(), []);
});

test('clear forgets what runs but still knows the agents', () => {
    const t = inOrder();
    t.see(agent('toolu_dev', { name: 'Dev', description: 'd' }));
    t.clear();
    assert.deepEqual(t.labels(), []);
    t.see(send('toolu_s', { to: 'Dev', message: '…' }));
    assert.deepEqual(t.labels(), ['Dev']);
});

test('history fed newest first replays in seq order', () => {
    const t = backgroundTracker();
    // The newest page (a resume, its stop, another resume) comes before the page with the launch.
    t.see(send('toolu_s2', { to: 'adev', summary: '第二轮' }), 40);
    t.see(stops(note('toolu_s1', 'adev')), 30);
    t.see(send('toolu_s1', { to: 'Dev' }), 20);
    assert.deepEqual(t.labels(), [], 'the launch is not loaded yet: nothing known');
    t.see(stops(note('toolu_dev', 'adev')), 11);
    t.see(agent('toolu_dev', { name: 'Dev', description: 'd' }), 10);
    assert.deepEqual(t.labels(), ['Dev · 第二轮']);
});

test('clear ends what ran before it, not what starts after', () => {
    const t = backgroundTracker();
    t.see(agent('toolu_a', { description: 'A' }), 1);
    t.see({ kind: 'agent', text: 'x' }, 5);
    t.clear();
    assert.deepEqual(t.labels(), []);
    t.see(agent('toolu_b', { description: 'B' }), 6);
    assert.deepEqual(t.labels(), ['B']);
    t.see(agent('toolu_old', { description: 'old' }), 2); // an older page loaded later
    assert.deepEqual(t.labels(), ['B']);
});

test('a task notification names the calls and tasks it stops', () => {
    assert.deepEqual(backgroundStops(note('toolu_1', 'a1')), [{ toolUseId: 'toolu_1', taskId: 'a1' }]);
    assert.deepEqual(
        backgroundStops(`  ${note('toolu_1', 'a1')}\n${note('toolu_2', 'b2', 'failed')}\n接着做`),
        [{ toolUseId: 'toolu_1', taskId: 'a1' }, { toolUseId: 'toolu_2', taskId: 'b2' }],
    );
    assert.deepEqual(backgroundStops('<task-notification><task-id>a9</task-id></task-notification>'), [{ toolUseId: null, taskId: 'a9' }]);
});

test('ordinary text, inline mentions and unfinished wrappers stop nothing', () => {
    assert.deepEqual(backgroundStops('hello'), []);
    assert.deepEqual(backgroundStops('see <task-notification><tool-use-id>x</tool-use-id></task-notification>'), []);
    assert.deepEqual(backgroundStops('<task-notification><tool-use-id>x</tool-use-id>'), []);
    assert.deepEqual(backgroundStops(`${note('a', 't')}\n<tool-use-id>quoted</tool-use-id>`), [{ toolUseId: 'a', taskId: 't' }]);
    assert.deepEqual(backgroundStops(undefined), []);
});

test('the status line names the newest and counts the rest', () => {
    assert.equal(backgroundText([]), '');
    assert.equal(backgroundText(['A']), '后台运行中：A');
    assert.equal(backgroundText(['A', 'B', 'C']), '后台运行中：C 等 3 个');
});

test('tasks name the launch call and when each (re)started', () => {
    const t = backgroundTracker();
    t.see({ ...agent('toolu_dev', { name: 'Dev', description: '实现' }), at: 1000, time: 900 }, 1);
    t.see({ kind: 'tool', call: 'toolu_sh', name: 'Bash', args: { command: 'npm test', run_in_background: true }, time: 1500 }, 2);
    assert.deepEqual(t.tasks(), [
        { id: 'toolu_dev', label: '实现', since: 1000 },
        { id: 'toolu_sh', label: 'npm test', since: 1500 },
    ]);
    t.see(stops(note('toolu_dev', 'adev')), 3);
    t.see({ ...send('toolu_s', { to: 'Dev', summary: '再补', message: '…' }), at: 5000 }, 4);
    assert.deepEqual(t.tasks(), [
        { id: 'toolu_sh', label: 'npm test', since: 1500 },
        { id: 'toolu_dev', label: 'Dev · 再补', since: 5000 },
    ]);
});
