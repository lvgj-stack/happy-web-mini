import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isThinking, noteTurnActivity, setActivity } from '../activity.js';

const session = () => ({ active: true, thinking: false });
const message = (turn, ev, extra = {}) => ({
    role: 'session', content: { role: 'agent', turn, time: 1000, ev, ...extra },
});
const heartbeat = (s, thinking, now = 1000) => setActivity(s, { active: true, thinking, activeAt: now }, now);

test('Codex automatic continuation works without a thinking heartbeat or an opened thread', () => {
    const s = session();
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 1, 1000);
    heartbeat(s, false);
    assert.equal(isThinking(s), true);
    noteTurnActivity(s, message('t1', { t: 'tool-call-start', call: 'c1', name: 'CodexBash', args: { command: 'rg foo' } }), 2, 1100);
    heartbeat(s, false, 1200);
    assert.equal(isThinking(s), true);
});

test('the next turn starts immediately inside the previous turn’s heartbeat mute window', () => {
    const s = session();
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 1, 1000);
    noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }), 2, 1100);
    heartbeat(s, true, 1200);
    assert.equal(isThinking(s), false, 'a late keepalive must not revive the ended turn');
    noteTurnActivity(s, message('t2', { t: 'turn-start' }), 3, 1300);
    heartbeat(s, false, 1400);
    assert.equal(isThinking(s), true);
});

test('completed, failed and aborted turns stop immediately even with a thinking heartbeat', () => {
    for (const status of ['completed', 'failed', 'aborted']) {
        const s = session();
        heartbeat(s, true);
        noteTurnActivity(s, message('t1', { t: 'turn-start' }), 1, 1000);
        noteTurnActivity(s, message('t1', { t: 'turn-end', status }), 2, 1100);
        assert.equal(isThinking(s), false, status);
        heartbeat(s, true, 1200);
        assert.equal(isThinking(s), false, status);
    }
});

test('late decryption and older history cannot overwrite a newer turn’s status', () => {
    const s = session();
    noteTurnActivity(s, message('t2', { t: 'turn-start' }), 30, 1000);
    noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }), 20, 1100);
    assert.equal(isThinking(s), true);
    noteTurnActivity(s, message('t2', { t: 'turn-end', status: 'completed' }), 40, 1200);
    noteTurnActivity(s, message('t2', { t: 'turn-start' }), 30, 1300);
    noteTurnActivity(s, message('t1', { t: 'text', text: 'old answer' }), 15, 1400);
    assert.equal(isThinking(s), false);
});

test('loading a page whose turn-start is earlier than the page still detects ongoing work', () => {
    const s = session();
    noteTurnActivity(s, message('t1', { t: 'text', text: 'checking the code', thinking: true }), 100, 1000);
    heartbeat(s, false);
    assert.equal(isThinking(s), true);
    noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }), 101, 1100);
    noteTurnActivity(s, message('t1', { t: 'text', text: 'late duplicate' }), 102, 1200);
    assert.equal(isThinking(s), false, 'trailing content must not reopen the same ended turn');
});

test('nested session envelopes report the same activity as direct envelopes', () => {
    const s = session();
    const raw = message('t1', { t: 'turn-start' });
    raw.content = { type: 'session', data: raw.content };
    noteTurnActivity(s, raw, 1, 1000);
    assert.equal(isThinking(s), true);
});

test('subagents, user messages and turn-less usage do not change main-turn activity', () => {
    const s = session();
    for (const raw of [
        message('t1', { t: 'turn-start' }, { subagent: 'child' }),
        message('t1', { t: 'text', text: 'hello' }, { role: 'user' }),
        message(null, { t: 'service', text: '' }, { usage: { inputTokens: 10 } }),
        { role: 'user', content: { type: 'text', text: 'hello' } },
        null,
    ]) noteTurnActivity(s, raw, 1, 1000);
    assert.equal(isThinking(s), false);
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 2, 1100);
    noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }, { subagent: 'child' }), 3, 1200);
    assert.equal(isThinking(s), true);
});

test('going offline clears unfinished work and reconnecting does not resurrect old history', () => {
    const s = session();
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 10, 1000);
    heartbeat(s, true);
    setActivity(s, { active: false, thinking: true }, 1100);
    assert.equal(isThinking(s), false);
    heartbeat(s, false, 1200);
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 10, 1300);
    assert.equal(isThinking(s), false);
    noteTurnActivity(s, message('t2', { t: 'turn-start' }), 11, 1400);
    assert.equal(isThinking(s), true);
});

test('legacy sessions continue to use heartbeats when there are no turn events', () => {
    const s = session();
    heartbeat(s, true);
    assert.equal(isThinking(s), true);
    heartbeat(s, false, 1100);
    assert.equal(isThinking(s), false);
    heartbeat(s, true, 1200);
    assert.equal(isThinking(s), true);
});

test('CLI ready and process-exit events close a turn even when turn-end is missing', () => {
    for (const ev of [
        { type: 'ready' },
        { type: 'message', message: 'Process exited unexpectedly' },
    ]) {
        const s = session();
        noteTurnActivity(s, message('t1', { t: 'turn-start' }), 10, 1000);
        noteTurnActivity(s, { role: 'agent', content: { type: 'event', data: ev } }, 11, 1100);
        heartbeat(s, false, 1200);
        assert.equal(isThinking(s), false);
        noteTurnActivity(s, message('t1', { t: 'text', text: 'older page' }), 10, 1300);
        assert.equal(isThinking(s), false);
        noteTurnActivity(s, message('t2', { t: 'turn-start' }), 12, 1400);
        assert.equal(isThinking(s), true);
    }
});

test('an old thinking heartbeat cannot revive work even after the mute window', () => {
    const s = session();
    heartbeat(s, true, 1000);
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 1, 1050);
    noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }, { time: 1100 }), 2, 1100, 1010);
    setActivity(s, { active: true, thinking: true, activeAt: 1005 }, 4000);
    assert.equal(isThinking(s), false);
    setActivity(s, { active: true, thinking: true, activeAt: 1020 }, 4100);
    assert.equal(isThinking(s), true, 'a genuinely newer heartbeat still reports new work');
});

test('heartbeat ordering respects both slow CLI clocks and server-clamped fast CLI clocks', () => {
    for (const [cliTime, serverTime, oldPing, newPing] of [
        [1100, 110000, 1099, 1200],
        [110000, 1100, 1099, 1200],
    ]) {
        const s = session();
        noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }, { time: cliTime }), 10, 1100, serverTime);
        setActivity(s, { active: true, thinking: true, activeAt: oldPing }, 4000);
        assert.equal(isThinking(s), false);
        setActivity(s, { active: true, thinking: true, activeAt: newPing }, 4100);
        assert.equal(isThinking(s), true);
    }
});

test('an old history request finishing after offline cannot seed work on idle reconnection', () => {
    const s = session();
    setActivity(s, { active: false, thinking: false }, 1000);
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 10, 1100);
    heartbeat(s, false, 1200);
    assert.equal(isThinking(s), false);
    noteTurnActivity(s, message('t2', { t: 'turn-start' }), 11, 1300);
    assert.equal(isThinking(s), true);
});

test('fresh progress after reconnection can resume the same unfinished turn', () => {
    const s = session();
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 10, 1000);
    setActivity(s, { active: false, thinking: false }, 1100);
    heartbeat(s, false, 1200);
    assert.equal(isThinking(s), false);
    noteTurnActivity(s, message('t1', { t: 'text', text: 'connection restored' }), 11, 1300);
    assert.equal(isThinking(s), true);
});

test('a previous turn’s ready cannot stop a Codex automatic continuation', () => {
    const s = session();
    noteTurnActivity(s, message('t1', { t: 'turn-start' }), 1, 1000);
    noteTurnActivity(s, message('t1', { t: 'turn-end', status: 'completed' }), 2, 1100);
    noteTurnActivity(s, message('t2', { t: 'turn-start' }), 3, 1200);
    noteTurnActivity(s, message('t2', { t: 'tool-call-start', call: 'c1', name: 'CodexBash', args: {} }), 4, 1300);
    noteTurnActivity(s, { role: 'agent', content: { type: 'event', data: { type: 'ready' } } }, 5, 1400);
    assert.equal(isThinking(s), true);
    noteTurnActivity(s, message('t2', { t: 'text', text: 'still running' }), 6, 1500);
    assert.equal(isThinking(s), true);
});
