// node --test: 靶场 — the magazine, the done streak, radar blips and where the HUD may draw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAG, RELOAD, blipSpots, createRange, fireRound, hudArea, nextStreak, tickMagazine } from '../range.js';

test('each message fires one round', () => {
    assert.deepEqual(fireRound({ ammo: 24, reload: 0 }), { ammo: 23, reload: 0 });
});

test('the last round starts a reload, and rounds fired while reloading are free', () => {
    const empty = fireRound({ ammo: 1, reload: 0 });
    assert.deepEqual(empty, { ammo: 0, reload: RELOAD });
    assert.deepEqual(fireRound(empty), empty);
});

test('a reload refills the magazine once its time is up', () => {
    let m = { ammo: 0, reload: RELOAD };
    m = tickMagazine(m, RELOAD / 2);
    assert.equal(m.ammo, 0);
    assert.ok(m.reload > 0);
    m = tickMagazine(m, RELOAD);
    assert.deepEqual(m, { ammo: MAG, reload: 0 });
    assert.deepEqual(tickMagazine({ ammo: 12, reload: 0 }, 1), { ammo: 12, reload: 0 }, 'nothing happens without a reload');
});

test('sessions done within 5 s of each other count up; a longer gap starts over', () => {
    let s = nextStreak({ count: 0, at: 0 }, 10_000);
    assert.equal(s.count, 1);
    s = nextStreak(s, 14_000);
    assert.equal(s.count, 2);
    s = nextStreak(s, 18_999);
    assert.equal(s.count, 3);
    s = nextStreak(s, 24_000);
    assert.equal(s.count, 1);
});

test('radar: working and waiting sessions first, at most 12, each at a spot of its own that does not move', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, status: i === 15 ? 'waiting' : i === 17 ? 'working' : 'idle' }));
    const spots = blipSpots(rows);
    assert.equal(spots.length, 12);
    assert.deepEqual(spots.slice(0, 2).map((b) => b.id).sort(), ['s15', 's17']);
    for (const b of spots) {
        assert.ok(b.r >= .3 && b.r <= .9, `${b.id} radius ${b.r}`);
        assert.ok(b.a >= 0 && b.a < Math.PI * 2, `${b.id} angle ${b.a}`);
    }
    const again = blipSpots([{ id: 's15', status: 'idle' }]);
    assert.deepEqual([again[0].a, again[0].r], [spots.find((b) => b.id === 's15').a, spots.find((b) => b.id === 's15').r], 'the spot depends on the session only');
    assert.deepEqual(blipSpots([]), []);
});

const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('HUD area: under the chat header, over the composer, left of the docked links panel', () => {
    const main = box(260, 0, 900, 700);
    assert.deepEqual(hudArea({ main, head: box(260, 0, 900, 56), composer: box(400, 580, 620, 110), links: box(876, 56, 284, 400) }), { top: 56, bottom: 580, right: 616 });
});

test('HUD area: no header, composer or links shown means the whole chat area', () => {
    const main = box(0, 20, 500, 600);
    assert.deepEqual(hudArea({ main, head: null, composer: box(0, 0, 0, 0), links: null }), { top: 0, bottom: 600, right: 500 });
});

test('reset drops what was still showing, so it does not replay after a skin switch', () => {
    const r = createRange();
    r.knock('重构登录页', 1000, null);
    r.knock('修复 CI', 2000, null);
    r.hurt();
    assert.equal(r.busy(), true);
    r.reset();
    assert.equal(r.busy(), false);
});

test('without a weapon drawn there is nowhere to fire from', () => {
    assert.equal(createRange().fire(), null);
});
