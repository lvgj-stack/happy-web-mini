// node --test: skins — what is picked, the time of day, and each skin's colors.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKINS, paletteFor, readSkin, setMotion, setSkin, timeOfDay } from '../skins.js';

const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const at = (h, min = 0) => new Date(2026, 10, 26, h, min);

test('nothing saved: the current look, with full motion', () => {
    assert.deepEqual(readSkin(memory(), false), { id: 'moss', motion: 'full' });
});

test('reduced motion and nothing picked yet: motion starts off', () => {
    assert.deepEqual(readSkin(memory(), true), { id: 'moss', motion: 'off' });
});

test('a motion picked by hand wins over reduced motion', () => {
    const s = memory();
    setMotion(s, 'events');
    assert.equal(readSkin(s, true).motion, 'events');
});

test('broken or unknown values fall back to the defaults', () => {
    const s = memory();
    s.setItem('happy.skin', '{oops');
    assert.deepEqual(readSkin(s, false), { id: 'moss', motion: 'full' });
    s.setItem('happy.skin', JSON.stringify({ v: 1, id: 'nope', motion: 'wild' }));
    assert.deepEqual(readSkin(s, false), { id: 'moss', motion: 'full' });
    s.setItem('happy.skin', JSON.stringify({ v: 2, id: 'sakura', motion: 'off' }));
    assert.deepEqual(readSkin(s, false), { id: 'moss', motion: 'full' }, 'another version is not read');
});

test('picking a skin keeps the motion, and the other way round', () => {
    const s = memory();
    setMotion(s, 'off');
    setSkin(s, 'wild');
    assert.deepEqual(readSkin(s, false), { id: 'wild', motion: 'off' });
    setMotion(s, 'events');
    assert.deepEqual(readSkin(s, false), { id: 'wild', motion: 'events' });
    setSkin(s, 'nope');
    assert.equal(readSkin(s, false).id, 'wild', 'an unknown skin is not saved');
});

test('the skins, in order', () => {
    assert.deepEqual(SKINS.map((k) => k.id), ['moss', 'sakura', 'wild']);
    for (const k of SKINS) { assert.ok(k.name); assert.ok(k.chip); }
});

test('time of day: day from 6, dusk from 17, night from 19', () => {
    assert.equal(timeOfDay(at(5, 59)), 'night');
    assert.equal(timeOfDay(at(6)), 'day');
    assert.equal(timeOfDay(at(16, 59)), 'day');
    assert.equal(timeOfDay(at(17)), 'dusk');
    assert.equal(timeOfDay(at(18, 59)), 'dusk');
    assert.equal(timeOfDay(at(19)), 'night');
    assert.equal(timeOfDay(at(0)), 'night');
});

test('the current look sets no colors of its own', () => {
    assert.deepEqual(paletteFor('moss', 'night'), { vars: {}, dark: false });
});

test('only 旷野 changes with the time, and only its night is dark', () => {
    assert.deepEqual(paletteFor('sakura', 'night'), paletteFor('sakura', 'day'));
    assert.equal(paletteFor('sakura', 'day').dark, false);
    assert.equal(paletteFor('wild', 'day').dark, false);
    assert.equal(paletteFor('wild', 'dusk').dark, false);
    assert.equal(paletteFor('wild', 'night').dark, true);
    assert.notEqual(paletteFor('wild', 'day').vars['--sheet'], paletteFor('wild', 'dusk').vars['--sheet']);
});

test('every palette gives every color the page reads', () => {
    const KEYS = ['--paper', '--sheet', '--ink', '--muted', '--rule', '--moss', '--moss-tint', '--surface', '--ink-rgb', '--head', '--head-hover',
        '--amber', '--code-bg', '--accent-hover', '--idle', '--faint', '--glass', '--sel', '--ring', '--menu'];
    for (const id of ['sakura', 'wild']) {
        for (const time of ['day', 'dusk', 'night']) {
            const { vars } = paletteFor(id, time);
            for (const k of KEYS) assert.ok(vars[k], `${id} ${time} sets ${k}`);
            assert.match(vars['--ink-rgb'], /^\d+, \d+, \d+$/);
        }
    }
});

test('an unknown skin reads as the current look', () => {
    assert.deepEqual(paletteFor('nope', 'day'), { vars: {}, dark: false });
});
