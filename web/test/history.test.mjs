// node --test: walking back through sent messages with ↑ / ↓.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onFirstLine, onLastLine, promptHistory, stepHistory } from '../history.js';

test('history is oldest first by seq, blank and back-to-back repeats dropped', () => {
    const prompts = new Map([[9, 'c'], [2, 'a'], [5, 'b'], [6, 'b '], [7, '  '], [8, 'a']]);
    assert.deepEqual(promptHistory(prompts), ['a', 'b', 'a', 'c']);
    assert.deepEqual(promptHistory(undefined), []);
});

test('↑ walks back from the newest, stops at the oldest', () => {
    const h = ['a', 'b', 'c'];
    let r = stepHistory(h, null, 'up', '');
    assert.equal(r.text, 'c');
    r = stepHistory(h, r.browse, 'up', r.text);
    assert.equal(r.text, 'b');
    r = stepHistory(h, r.browse, 'up', r.text);
    assert.equal(r.text, 'a');
    assert.equal(stepHistory(h, r.browse, 'up', r.text), null);
});

test('↓ walks forward and past the newest gives back the draft', () => {
    const h = ['a', 'b'];
    const up1 = stepHistory(h, null, 'up', '');
    const up2 = stepHistory(h, up1.browse, 'up', up1.text);
    const down1 = stepHistory(h, up2.browse, 'down', up2.text);
    assert.equal(down1.text, 'b');
    const down2 = stepHistory(h, down1.browse, 'down', down1.text);
    assert.deepEqual(down2, { browse: null, text: '' });
    assert.equal(stepHistory(h, null, 'down', ''), null);
});

test('nothing sent yet: ↑ does nothing', () => {
    assert.equal(stepHistory([], null, 'up', ''), null);
});

test('first / last line of the caret', () => {
    assert.ok(onFirstLine('ab\ncd', 2));
    assert.ok(!onFirstLine('ab\ncd', 3));
    assert.ok(onLastLine('ab\ncd', 3));
    assert.ok(!onLastLine('ab\ncd', 2));
});
