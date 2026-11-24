// node --test: token-usage aggregation, quartile levels and the week grid.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTokens, heatmapWeeks, levelOf, summarize, thresholds } from '../heatmap.js';

const today = new Date(2026, 10, 24); // Tuesday

test('summarize: sessions add up per day, agents stay apart', () => {
    const s = summarize([
        { agent: 'claude', days: { '2026-11-24': [1, 2, 3, 4], '2026-11-20': [10, 0, 0, 0] } },
        { agent: 'codex', days: { '2026-11-24': [5, 0, 0, 0] } },
        { agent: 'claude', days: { '2026-11-24': [0, 0, 0, 100] } },
    ], today);
    const d = s.byDay.get('2026-11-24');
    assert.equal(d.total, 115);
    assert.deepEqual(d.parts, [6, 2, 3, 104]);
    assert.deepEqual(d.agents, { claude: 110, codex: 5 });
    assert.equal(s.total, 125);
    assert.deepEqual(s.best, { day: '2026-11-24', total: 115 });
});

test('summarize: last30 is today and the 29 days before', () => {
    const s = summarize([{ agent: 'claude', days: {
        '2026-11-24': [1, 0, 0, 0],
        '2026-10-26': [10, 0, 0, 0], // 29 days ago: in
        '2026-10-25': [100, 0, 0, 0], // 30 days ago: out
    } }], today);
    assert.equal(s.last30, 11);
    assert.equal(s.total, 111);
});

test('summarize: best prefers the earlier day on a tie; empty input', () => {
    const s = summarize([{ agent: 'a', days: { '2026-11-02': [5, 0, 0, 0], '2026-11-01': [5, 0, 0, 0] } }], today);
    assert.equal(s.best.day, '2026-11-01');
    const e = summarize([], today);
    assert.equal(e.total, 0);
    assert.equal(e.last30, 0);
    assert.equal(e.best, null);
    assert.equal(e.byDay.size, 0);
});

test('thresholds and levelOf', () => {
    assert.deepEqual(thresholds([0, 5]), [0, 0, 0]);
    assert.equal(levelOf(5, thresholds([0, 5])), 4);
    assert.deepEqual(thresholds([]), [0, 0, 0]);
    const t = thresholds([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(t, [2, 4, 6]);
    assert.equal(levelOf(0, t), 0);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => levelOf(n, t)), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('heatmapWeeks: Tuesday today', () => {
    const w = heatmapWeeks(new Map(), today);
    assert.equal(w.length, 53);
    const last = w[52];
    assert.equal(last.days[0].day, '2026-11-23');
    assert.equal(last.days[1].day, '2026-11-24');
    assert.equal(last.days[2], null);
    assert.equal(w[0].days[0].day, '2025-11-24');
});

test('heatmapWeeks: Sunday today fills the last column', () => {
    const w = heatmapWeeks(new Map(), new Date(2026, 10, 29));
    assert.ok(w[52].days.every((d) => d !== null));
    assert.equal(w[52].days[6].day, '2026-11-29');
});

test('heatmapWeeks: across the year boundary', () => {
    const w = heatmapWeeks(new Map(), new Date(2027, 0, 1));
    const days = w[52].days.map((d) => d && d.day);
    assert.ok(days.includes('2026-12-28'));
    assert.equal(days[4], '2027-01-01');
    assert.equal(w[52].month, '1月');
});

test('heatmapWeeks: month labels, totals and levels', () => {
    const byDay = new Map([['2026-11-24', { total: 9, parts: [9, 0, 0, 0], agents: {} }], ['2026-11-23', { total: 3, parts: [3, 0, 0, 0], agents: {} }]]);
    const w = heatmapWeeks(byDay, today);
    const nov1 = w.find((c) => c.days.some((d) => d && d.day === '2026-11-01'));
    assert.equal(nov1.month, '11月');
    assert.equal(w[51].month, null);
    assert.equal(w[0].month, '11月');
    assert.equal(w[52].days[1].total, 9);
    assert.equal(w[52].days[1].level, 4);
    assert.equal(w[52].days[0].level, 1);
    assert.equal(w[51].days[0].level, 0);
});

test('formatTokens: three significant digits with K / M / B', () => {
    assert.equal(formatTokens(0), '0');
    assert.equal(formatTokens(820), '820');
    assert.equal(formatTokens(999), '999');
    assert.equal(formatTokens(1000), '1K');
    assert.equal(formatTokens(8240), '8.24K');
    assert.equal(formatTokens(125000), '125K');
    assert.equal(formatTokens(48200000), '48.2M');
    assert.equal(formatTokens(76270000), '76.3M');
    assert.equal(formatTokens(6570000000), '6.57B');
    assert.equal(formatTokens(1240000000000), '1240B');
    // Rounding that reaches 1000 of a unit carries into the next one.
    assert.equal(formatTokens(999950), '1M');
    assert.equal(formatTokens(999600000), '1B');
    assert.equal(formatTokens(9996), '10K');
});

test('summarize: all-zero days give no best; missing parts do not make NaN', () => {
    const z = summarize([{ agent: 'a', days: { '2026-11-01': [0, 0, 0, 0] } }], today);
    assert.equal(z.best, null);
    const m = summarize([{ agent: 'a', days: { '2026-11-01': [3, 2] } }], today);
    assert.equal(m.total, 5);
});

test('heatmapWeeks: the levels come from the days shown, not older ones', () => {
    const byDay = new Map([
        ['2024-01-01', { total: 1e9 }], // long before the map
        ['2026-11-20', { total: 10 }],
        ['2026-11-21', { total: 20 }],
        ['2026-11-22', { total: 30 }],
        ['2026-11-23', { total: 40 }],
    ]);
    const levels = Object.fromEntries(heatmapWeeks(byDay, today).flatMap((w) => w.days).filter((d) => d?.total).map((d) => [d.day, d.level]));
    assert.deepEqual(levels, { '2026-11-20': 1, '2026-11-21': 2, '2026-11-22': 3, '2026-11-23': 4 });
});
