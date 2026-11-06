// node --test: placement and item filtering of the list's right-click menu.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuPosition, visibleItems } from '../contextmenu.js';

test('opens at the pointer when it fits', () => {
    assert.deepEqual(menuPosition(100, 200, 180, 150, 1200, 800), { left: 100, top: 200 });
});

test('flips left / up near the right and bottom edges', () => {
    assert.deepEqual(menuPosition(1100, 700, 180, 150, 1200, 800), { left: 920, top: 550 });
});

test('clamps into the window when neither side fits', () => {
    assert.deepEqual(menuPosition(100, 50, 180, 790, 1200, 800), { left: 100, top: 6 });
    assert.deepEqual(menuPosition(10, 10, 300, 100, 200, 800), { left: 6, top: 10 });
});

test('drops hidden items and stray separators', () => {
    const a = { label: 'a' }, b = { label: 'b' };
    assert.deepEqual(visibleItems(['-', a, { label: 'x', hidden: true }, '-', '-', b, '-', null]), [a, '-', b]);
    assert.deepEqual(visibleItems([{ label: 'x', hidden: true }, '-']), []);
});
