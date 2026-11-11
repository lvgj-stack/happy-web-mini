// node --test: the chat area's text size, as kept in localStorage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCALES, readChatScale, setChatScale } from '../fontscale.js';

const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('the steps, smallest first, 标准 at 100%', () => {
    assert.deepEqual(SCALES.map((s) => [s.name, s.value]), [['小', 0.9], ['标准', 1], ['大', 1.1], ['更大', 1.25], ['特大', 1.4]]);
});

test('nothing saved, or something that is not a step: 标准', () => {
    const s = memory();
    assert.equal(readChatScale(s), 1);
    for (const bad of ['', 'abc', '3', '0', '-1', '1.05', 'NaN', 'Infinity']) {
        s.setItem('happy.chatScale', bad);
        assert.equal(readChatScale(s), 1, bad);
    }
});

test('a step is kept, and 标准 leaves nothing behind', () => {
    const s = memory();
    setChatScale(s, 1.25);
    assert.equal(s.getItem('happy.chatScale'), '1.25');
    assert.equal(readChatScale(s), 1.25);
    setChatScale(s, 1);
    assert.equal(s.getItem('happy.chatScale'), null);
    assert.equal(readChatScale(s), 1);
});

test('a value that is not a step is not saved', () => {
    const s = memory();
    setChatScale(s, 1.4);
    setChatScale(s, 7);
    assert.equal(readChatScale(s), 1, 'falls back to 标准');
    assert.equal(s.getItem('happy.chatScale'), null);
});
