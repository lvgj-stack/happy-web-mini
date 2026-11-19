// node --test: keeping a subagent's steps apart from the main agent's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchedSubagents, subagentStore, stepsText } from '../subagents.js';

// Shapes as app.js's toView makes them from a real Claude session (happy-cli 1.2.6).
const SUB = 'c93a83e0961fb7553c181087';
const launch = {
    kind: 'tool', call: 'toolu_01Foph', name: 'Agent', title: 'List web test files', subagent: null, time: 1000,
    args: { description: 'List web test files', subagent_type: 'Explore', prompt: 'Read turns.js', sessionSubagent: SUB },
};
const child = [
    [68, { kind: 'subagent-start', title: 'List web test files', subagent: SUB, time: 1010 }],
    [69, { kind: 'agent', text: 'Read turns.js', subagent: SUB, time: 1011 }],
    [70, { kind: 'tool', call: 'toolu_012k', name: 'Bash', args: { command: 'head turns.js' }, subagent: SUB, time: 2000 }],
    [71, { kind: 'tool-end', call: 'toolu_012k', subagent: SUB, time: 2500 }],
    [72, { kind: 'subagent-stop', subagent: SUB, time: 5000 }],
];

test('an Agent call names the child it launches; other calls and the child\'s own calls do not', () => {
    assert.deepEqual(launchedSubagents(launch), [SUB]);
    assert.deepEqual(launchedSubagents({ kind: 'tool', call: 'x', name: 'Bash', args: { command: 'ls' } }), []);
    assert.deepEqual(launchedSubagents({ ...launch, subagent: 'cother' }), []);
    assert.deepEqual(launchedSubagents({ kind: 'agent', text: 'hi' }), []);
});

test('Codex can launch several children from one call', () => {
    const view = { kind: 'tool', call: 'call_1', name: 'CodexSubagent', args: { tool: 'spawnAgent', sessionSubagent: 'ca', sessionSubagents: ['ca', 'cb'] } };
    assert.deepEqual(launchedSubagents(view), ['ca', 'cb']);
});

test('a child\'s steps are kept in order, whatever order they arrive in', () => {
    const store = subagentStore();
    for (const [seq, view] of child.slice().reverse()) store.see(view, seq);
    assert.equal(store.see(launch, 67), null); // the main agent's own step
    assert.deepEqual(store.steps(SUB).map((s) => s.seq), [69, 70]);
    assert.ok(store.ended(SUB, 'toolu_012k'));
    assert.deepEqual(store.summary(SUB), { title: 'List web test files', tools: 1, stopped: true, first: 1010, last: 5000 });
    assert.ok(store.worked(SUB));
});

test('a child still at work is not stopped', () => {
    const store = subagentStore();
    for (const [seq, view] of child.slice(0, 3)) store.see(view, seq);
    assert.equal(store.summary(SUB).stopped, false);
    assert.equal(store.ended(SUB, 'toolu_012k'), false);
});

test('a resumed Codex child runs again until its next stop', () => {
    const store = subagentStore();
    const id = 'c6b17039f39b289de7bebd20';
    store.see({ kind: 'subagent-start', title: '/root/notes', subagent: id }, 647);
    store.see({ kind: 'meta', text: 'Codex subagent started: /root/notes', subagent: id }, 648);
    store.see({ kind: 'subagent-stop', subagent: id }, 650);
    store.see({ kind: 'subagent-start', title: '/root/notes', subagent: id }, 686);
    assert.equal(store.summary(id).stopped, false);
    assert.equal(store.worked(id), false); // only reports, no line of its own
    store.see({ kind: 'subagent-stop', subagent: id }, 688);
    assert.equal(store.summary(id).stopped, true);
});

test('an unknown child reads as empty', () => {
    const store = subagentStore();
    assert.equal(store.has('cnone'), false);
    assert.deepEqual(store.steps('cnone'), []);
    assert.equal(store.summary('cnone').tools, 0);
});

test('step count text', () => {
    assert.equal(stepsText(0), '');
    assert.equal(stepsText(3), '3 步');
});
