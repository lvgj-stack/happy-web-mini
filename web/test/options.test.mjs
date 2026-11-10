// node --test: the agent's <options> block, split out of its text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitOptions } from '../options.js';

test('options: the block at the end becomes choices and leaves the text', () => {
    const text = '选一个方案：\n\n<options>\n    <option>两段式（推荐）</option>\n    <option>只用 CSQAQ</option>\n</options>\n';
    assert.deepEqual(splitOptions(text), { text: '选一个方案：', options: ['两段式（推荐）', '只用 CSQAQ'] });
});

test('options: one-line block and text after it', () => {
    assert.deepEqual(splitOptions('A\n<options><option>是</option><option> 否 </option></options>\nB'), { text: 'A\nB', options: ['是', '否'] });
});

test('options: none, or inside a code fence, leaves the text as is', () => {
    assert.deepEqual(splitOptions('plain  \n'), { text: 'plain  \n', options: [] });
    const fenced = '```xml\n<options>\n<option>x</option>\n</options>\n```';
    assert.deepEqual(splitOptions(fenced), { text: fenced, options: [] });
    assert.deepEqual(splitOptions(undefined), { text: '', options: [] });
});

test('options: an unclosed block (still streaming) keeps the choices seen so far', () => {
    assert.deepEqual(splitOptions('Q\n<options>\n<option>a</option>\n<option>b'), { text: 'Q', options: ['a'] });
});
