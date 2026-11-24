// node --test: per-reply token usage from decrypted messages, summed per local day.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replyUsage, tokenStats } from '../tokens.js';

const env = (usage, extra = {}) => ({ role: 'session', content: { type: 'session', data: { id: 'e', time: 1, role: 'agent', turn: 't1', ev: { t: 'text', text: 'hi' }, usage, ...extra } } });
const u = { input_tokens: 4, cache_creation_input_tokens: 2528, cache_read_input_tokens: 13594, output_tokens: 6 };
const at = new Date(2026, 10, 3, 23, 30).getTime(); // local 2026-11-03
const pick = (r) => ({ input: r.input, output: r.output, cacheWrite: r.cacheWrite, cacheRead: r.cacheRead });
const legacy = (message, extra = {}) => ({ role: 'agent', content: { type: 'output', data: { type: 'assistant', timestamp: '2026-11-03T12:00:00.000Z', message, ...extra } } });

test('replyUsage: session envelope, subagent included, Codex usage-only service envelope', () => {
    assert.deepEqual(pick(replyUsage(env(u))), { input: 4, output: 6, cacheWrite: 2528, cacheRead: 13594 });
    assert.ok(replyUsage(env(u, { subagent: 'ckabc' })));
    const codex = { role: 'session', content: { type: 'session', data: { id: 'c', time: 1, role: 'agent', ev: { t: 'service', text: '' }, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20 } } } };
    assert.deepEqual(pick(replyUsage(codex)), { input: 100, output: 20, cacheWrite: 0, cacheRead: 900 });
    assert.equal(replyUsage(env(undefined)), null);
    assert.equal(replyUsage({ role: 'user', content: { type: 'text', text: 'x' } }), null);
});

test('replyUsage: negative and non-numeric fields count as 0; time comes from the envelope', () => {
    const r = replyUsage(env({ input_tokens: 5, output_tokens: -3, cache_read_input_tokens: 'x' }));
    assert.deepEqual(pick(r), { input: 5, output: 0, cacheWrite: 0, cacheRead: 0 });
    assert.equal(r.time, 1);
});

test('replyUsage: legacy Claude output keyed by message id, sidechain included', () => {
    const r = replyUsage(legacy({ id: 'msg_1', usage: u }, { isSidechain: true }));
    assert.equal(r.key, 'm|msg_1');
    assert.deepEqual(pick(r), { input: 4, output: 6, cacheWrite: 2528, cacheRead: 13594 });
    assert.equal(r.time, Date.parse('2026-11-03T12:00:00.000Z'));
    assert.match(replyUsage(legacy({ usage: u })).key, /^m\|/);
    assert.equal(replyUsage(legacy({ id: 'x' })), null);
});

test('tokenStats: the same reply split over several messages counts once', () => {
    const st = tokenStats(null);
    assert.equal(st.see(env(u), { seq: 1, createdAt: at }), true);
    assert.equal(st.see(env(u), { seq: 2, createdAt: at }), false);
    assert.equal(st.see(env({ ...u, cache_read_input_tokens: 20000 }), { seq: 3, createdAt: at }), true);
    assert.deepEqual(st.days['2026-11-03'], [8, 12, 5056, 33594]);
});

test('tokenStats: falls back to usage.time, and skips when there is no time', () => {
    const st = tokenStats(null);
    assert.equal(st.see(env(u, { time: at }), { seq: 1 }), true);
    assert.deepEqual(st.days['2026-11-03'], [4, 6, 2528, 13594]);
    assert.equal(st.see(env({ ...u, input_tokens: 9 }, { time: undefined }), { seq: 2 }), false);
});

test('tokenStats: a duplicate on the edge of a cached run is not counted again', () => {
    const a = tokenStats(null); a.see(env(u), { seq: 10, createdAt: at });
    const b = tokenStats(JSON.parse(JSON.stringify(a.toJSON())));
    assert.equal(b.see(env(u), { seq: 11, createdAt: at }), false); // newer page
    assert.equal(b.see(env(u), { seq: 9, createdAt: at }), false);  // older page
    assert.deepEqual(b.days['2026-11-03'], [4, 6, 2528, 13594]);
});

test('tokenStats: bad cache starts empty', () => {
    assert.deepEqual(tokenStats({ days: 'x' }).days, {});
    assert.deepEqual(tokenStats({ days: { 'bad': [1] , '2026-01-01': [1, 2, 3, 4] }, edge: 5 }).days, { '2026-01-01': [1, 2, 3, 4] });
    assert.deepEqual(tokenStats(null).days, {});
});
