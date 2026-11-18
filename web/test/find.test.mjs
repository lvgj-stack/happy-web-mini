// node --test: the pure parts of find.js (Mac app ⌘F).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findMatches, matchLabel, stepMatch } from '../find.js';

test('findMatches ignores case, does not overlap, finds CJK', () => {
    assert.deepEqual(findMatches('Foo foo FOO', 'foo'), [0, 4, 8]);
    assert.deepEqual(findMatches('aaaa', 'aa'), [0, 2]);
    assert.deepEqual(findMatches('修复登录超时，登录页', '登录'), [2, 7]);
    assert.deepEqual(findMatches('anything', ''), []);
    assert.deepEqual(findMatches('nothing here', 'zzz'), []);
});

test('findMatches gives up rather than drift when lower-casing changes length', () => {
    assert.deepEqual(findMatches('İstanbul i', 'i'), []);
});

test('stepMatch wraps both ways and starts at an end', () => {
    assert.equal(stepMatch(0, 3, 'next'), 1);
    assert.equal(stepMatch(2, 3, 'next'), 0);
    assert.equal(stepMatch(0, 3, 'prev'), 2);
    assert.equal(stepMatch(-1, 3, 'next'), 0);
    assert.equal(stepMatch(-1, 3, 'prev'), 2);
    assert.equal(stepMatch(5, 3, 'next'), 0);
    assert.equal(stepMatch(0, 0, 'next'), -1);
});

test('matchLabel', () => {
    assert.equal(matchLabel(2, 12, 'x'), '3/12');
    assert.equal(matchLabel(-1, 0, 'x'), '0/0');
    assert.equal(matchLabel(-1, 0, ''), '');
});
