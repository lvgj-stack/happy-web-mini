// node --test: which block of a turn a step goes into, once the person has written in the middle of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addBreak, isBreak, isCut, segmentFor } from '../turns.js';

const seg = (seq, maxSeq = seq) => ({ seq, maxSeq });

test('isBreak: what the person sent, not what the SDK or the agent recorded', () => {
    assert.equal(isBreak({ kind: 'user', text: '继续' }), true);
    assert.equal(isBreak({ kind: 'image', mine: true, ref: 'r1' }), true);
    assert.equal(isBreak({ kind: 'image', mine: false, ref: 'r1' }), false, "the agent's picture");
    assert.equal(isBreak({ kind: 'image', mine: true }), false, 'nothing to show');
    assert.equal(isBreak({ kind: 'user', text: '  ' }), false, 'nothing to show');
    assert.equal(isBreak({ kind: 'agent', text: 'hi', turn: 't1' }), false);
    assert.equal(isBreak({ kind: 'stops', stops: ['a'] }), false, 'a <task-notification>');
    assert.equal(isBreak({ kind: 'output', text: 'x' }), false);
    assert.equal(isBreak(null), false);
});

test('addBreak keeps the seqs sorted and says whether one was added', () => {
    const breaks = [];
    assert.equal(addBreak(breaks, 150), true);
    assert.equal(addBreak(breaks, 30), true);
    assert.equal(addBreak(breaks, 90), true);
    assert.equal(addBreak(breaks, 90), false);
    assert.deepEqual(breaks, [30, 90, 150]);
});

test('a turn nobody interrupted stays one block', () => {
    assert.equal(segmentFor([], [], 100), -1, 'its first step opens one');
    assert.equal(segmentFor([seg(100, 149)], [], 150), 0);
    assert.equal(segmentFor([seg(100, 149)], [90], 150), 0, 'the message that started it is before it');
    assert.equal(segmentFor([seg(100, 149)], [90, 300], 150), 0);
});

test('steps after a message sent mid-turn open a new block after it', () => {
    // turn 100..149, the person writes at 150, the turn goes on at 151
    const segments = [seg(100, 149)];
    assert.equal(segmentFor(segments, [150], 151), -1);
    segments.push(seg(151, 160));
    assert.equal(segmentFor(segments, [150], 161), 1);
    assert.equal(segmentFor(segments, [150, 170], 171), -1, 'and again after the next one');
});

test('paging back: steps from before the message do not join the block from after it', () => {
    // On screen: the turn's later part, 150..200. The older page holds 100..120, the message at 130, 131..149.
    const breaks = [130];
    const segments = [seg(150, 200)];
    assert.equal(segmentFor(segments, breaks, 100), -1);
    segments.unshift(seg(100, 100));
    assert.equal(segmentFor(segments, breaks, 120), 0);
    assert.equal(segmentFor(segments, breaks, 131), 1, 'what came after the message joins the later block');
});

test('steps that only close something never open a block of their own', () => {
    // turn-end / tool-call-end right after the message: they belong to the block before it
    assert.equal(segmentFor([seg(100, 149)], [150], 151, false), 0);
    assert.equal(segmentFor([seg(100, 149), seg(151, 160)], [150, 170], 171, false), 1);
    assert.equal(segmentFor([seg(150, 200)], [130], 100, false), 0, 'nothing before it: the nearest one after');
    assert.equal(segmentFor([], [], 100, false), -1, 'unless the turn has none yet');
});

test('isCut: the person wrote after the block began', () => {
    assert.equal(isCut(seg(100, 149), []), false);
    assert.equal(isCut(seg(100, 149), [90]), false, 'the message that started it');
    assert.equal(isCut(seg(100, 149), [90, 150]), true);
    assert.equal(isCut(seg(151, 160), [90, 150]), false, 'the block after the message runs on');
});
