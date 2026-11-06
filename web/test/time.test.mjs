// node --test: when a message was sent, as the chat shows it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messageTime } from '../time.js';

const now = new Date(2026, 10, 6, 15, 0).getTime(); // 2026-11-06 15:00 local

test('today: just the clock, 24-hour', () => {
    assert.equal(messageTime(new Date(2026, 10, 6, 14, 32).getTime(), now), '14:32');
    assert.equal(messageTime(new Date(2026, 10, 6, 0, 5).getTime(), now), '00:05');
});

test('yesterday, earlier this year, another year', () => {
    assert.equal(messageTime(new Date(2026, 10, 5, 23, 59).getTime(), now), '昨天 23:59');
    assert.equal(messageTime(new Date(2026, 10, 1, 9, 3).getTime(), now), '11月1日 09:03');
    assert.equal(messageTime(new Date(2025, 11, 31, 18, 0).getTime(), now), '2025年12月31日 18:00');
});

test('no time, nothing to show', () => {
    assert.equal(messageTime(0, now), '');
    assert.equal(messageTime(undefined, now), '');
    assert.equal(messageTime(NaN, now), '');
});
