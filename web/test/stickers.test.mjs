// node --test: custom stickers for the skins, as kept in localStorage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SLOTS, readStickers, removeSticker, setSticker } from '../stickers.js';

const memory = () => {
    const m = new Map();
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('the three places, in order', () => {
    assert.deepEqual(SLOTS, ['fall', 'done', 'ask']);
});

test('nothing saved: no stickers', () => {
    assert.deepEqual(readStickers(memory()), { fall: '', done: '', ask: '' });
});

test('a sticker is kept per place and read back', () => {
    const s = memory();
    setSticker(s, 'done', PNG);
    assert.deepEqual(readStickers(s), { fall: '', done: PNG, ask: '' });
    assert.equal(s.m.get('happy.skin.sticker.done'), PNG);
});

test('only a PNG data URL of a modest size is taken, and nothing is written otherwise', () => {
    const s = memory();
    assert.throws(() => setSticker(s, 'fall', 'data:image/jpeg;base64,/9j/'), /图片/);
    assert.throws(() => setSticker(s, 'fall', 'javascript:alert(1)'), /图片/);
    assert.throws(() => setSticker(s, 'fall', `data:image/png;base64,${'A'.repeat(200_001)}`), /太大/);
    assert.throws(() => setSticker(s, 'hat', PNG), /位置/);
    assert.equal(s.m.size, 0);
});

test('a full storage error comes through as it is', () => {
    const s = memory();
    s.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
    assert.throws(() => setSticker(s, 'ask', PNG), { name: 'QuotaExceededError' });
});

test('removing a sticker leaves the others', () => {
    const s = memory();
    setSticker(s, 'fall', PNG);
    setSticker(s, 'ask', PNG);
    removeSticker(s, 'fall');
    assert.deepEqual(readStickers(s), { fall: '', done: '', ask: PNG });
});

test('a value broken in storage reads as no sticker', () => {
    const s = memory();
    s.setItem('happy.skin.sticker.fall', 'data:image/png;base64,<script>');
    s.setItem('happy.skin.sticker.done', 'url(x)');
    assert.deepEqual(readStickers(s), { fall: '', done: '', ask: '' });
});
