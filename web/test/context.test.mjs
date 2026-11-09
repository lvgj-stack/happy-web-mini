// node --test: how full the context is, from the usage replies carry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextLine, contextUsage, tokens } from '../context.js';

const env = (extra) => ({ role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'hi' }, ...extra } });
const usage = { input_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 73000, output_tokens: 400 };

test('an agent envelope with usage: what the model read, and its window', () => {
    assert.deepEqual(contextUsage(env({ usage: { ...usage, context_window: 200000 } })), { used: 74005, window: 200000 });
    assert.deepEqual(contextUsage(env({ usage })), { used: 74005, window: null }, 'first turn: window not known yet');
    // Wrapped as { type: 'session', data } too.
    assert.deepEqual(contextUsage({ role: 'session', content: { type: 'session', data: env({ usage }).content } }), { used: 74005, window: null });
});

test("a subagent's usage, user envelopes and records without usage say nothing", () => {
    assert.equal(contextUsage(env({ usage, subagent: 'sub1' })), null);
    assert.equal(contextUsage({ role: 'session', content: { role: 'user', ev: { t: 'text', text: 'x' }, usage } }), null);
    assert.equal(contextUsage(env({})), null);
    assert.equal(contextUsage(env({ usage: { output_tokens: 3 } })), null);
    assert.equal(contextUsage({ role: 'user', content: { type: 'text', text: 'hi' } }), null);
    assert.equal(contextUsage(null), null);
});

test("older CLIs: Claude's raw assistant message, sidechains skipped", () => {
    const out = (data) => ({ role: 'agent', content: { type: 'output', data } });
    assert.deepEqual(contextUsage(out({ type: 'assistant', message: { usage } })), { used: 74005, window: null });
    assert.equal(contextUsage(out({ type: 'assistant', isSidechain: true, message: { usage } })), null);
    assert.equal(contextUsage(out({ type: 'user', message: { usage } })), null);
});

test('token counts read short', () => {
    assert.equal(tokens(812), '812');
    assert.equal(tokens(8200), '8.2K');
    assert.equal(tokens(8000), '8K');
    assert.equal(tokens(74005), '74K');
    assert.equal(tokens(1_000_000), '1M');
    assert.equal(tokens(1_250_000), '1.3M');
});

test('the composer line: what is left, warning as it runs out', () => {
    assert.deepEqual(contextLine({ used: 74005, window: 200000 }), { text: '上下文剩 63%', level: 'ok', title: '上下文：已用 74K / 200K tokens，剩 63%' });
    assert.equal(contextLine({ used: 160000, window: 200000 }).level, 'warn');
    assert.equal(contextLine({ used: 185000, window: 200000 }).level, 'over');
    assert.equal(contextLine({ used: 250000, window: 200000 }).text, '上下文剩 0%');
    assert.equal(contextLine({ used: 74005, window: null }).text, '上下文 74K');
});
