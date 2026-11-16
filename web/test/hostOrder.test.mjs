// node --test: the order of computers in the sidebar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveHost, readHostOrder, sortHosts, writeHostOrder } from '../hostOrder.js';

const m = (key, name) => ({ key, name });
const keys = (list) => list.map((x) => x.key);

test('no stored order: by name, then key', () => {
    const list = [m('c', 'mini'), m('a', 'MacBook'), m('b', 'mini')];
    assert.deepEqual(keys(sortHosts(list, [])), ['a', 'b', 'c']);
});

test('placed computers first in their order, the rest by name', () => {
    const list = [m('a', 'a'), m('b', 'b'), m('c', 'c'), m('d', 'd')];
    assert.deepEqual(keys(sortHosts(list, ['c', 'gone', 'a'])), ['c', 'a', 'b', 'd']);
});

test('reading a stored order tolerates junk', () => {
    assert.deepEqual(readHostOrder(writeHostOrder(['x', 'y'])), ['x', 'y']);
    assert.deepEqual(readHostOrder(null), []);
    assert.deepEqual(readHostOrder('{bad'), []);
    assert.deepEqual(readHostOrder('["x"]'), []);
    assert.deepEqual(readHostOrder('{"v":2,"keys":["x"]}'), []);
    assert.deepEqual(readHostOrder('{"v":1,"keys":["x",3,"x","y"]}'), ['x', 'y']);
});

test('moving before or after another computer', () => {
    const shown = ['a', 'b', 'c'];
    assert.deepEqual(moveHost([], shown, 'c', 'a'), ['c', 'a', 'b']);
    assert.deepEqual(moveHost([], shown, 'a', 'c', true), ['b', 'c', 'a']);
    assert.deepEqual(moveHost([], shown, 'a', 'b', true), ['b', 'a', 'c']);
});

test('onto itself or an unknown computer: unchanged', () => {
    const order = ['b', 'a'];
    assert.equal(moveHost(order, ['b', 'a'], 'a', 'a'), order);
    assert.equal(moveHost(order, ['b', 'a'], 'a', 'zzz'), order);
});

test('offline computers keep their place', () => {
    // 'off' sits between b and a; only b, a, n (new) are online.
    const order = ['b', 'off', 'a'];
    const shown = keys(sortHosts([m('a', 'a'), m('b', 'b'), m('n', 'n')], order));
    assert.deepEqual(shown, ['b', 'a', 'n']);
    const next = moveHost(order, shown, 'n', 'b');
    assert.deepEqual(next, ['n', 'b', 'off', 'a']);
    assert.deepEqual(keys(sortHosts([m('a', 'a'), m('b', 'b'), m('n', 'n'), m('off', 'off')], next)), ['n', 'b', 'off', 'a']);
});
