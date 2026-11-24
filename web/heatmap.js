// Token-usage heatmap: per-day aggregation, quartile levels, the week grid and number formatting.
import { localDay } from './time.js';

/** Local calendar date n days after `d` (negative: before), stepped via new Date(y, m, d) so DST cannot skew it. */
function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Sum every entry's per-day [input, output, cacheWrite, cacheRead] into totals, a last-30-days figure and the busiest day. */
export function summarize(entries, today) {
    const byDay = new Map();
    let total = 0;
    for (const { agent, days } of entries) {
        for (const [day, parts] of Object.entries(days || {})) {
            let d = byDay.get(day);
            if (!d) {
                d = { total: 0, parts: [0, 0, 0, 0], agents: {} };
                byDay.set(day, d);
            }
            const sum = parts.reduce((a, b) => a + (b || 0), 0);
            for (let i = 0; i < 4; i++) d.parts[i] += parts[i] || 0;
            d.total += sum;
            d.agents[agent] = (d.agents[agent] || 0) + sum;
            total += sum;
        }
    }
    const from = localDay(addDays(today, -29).getTime());
    const to = localDay(today.getTime());
    let last30 = 0;
    let best = null;
    for (const [day, d] of byDay) {
        if (day >= from && day <= to) last30 += d.total;
        if (d.total <= 0) continue;
        if (!best || d.total > best.total || (d.total === best.total && day < best.day)) best = { day, total: d.total };
    }
    return { total, last30, best, byDay };
}

/** Quartile cut-offs (25% / 50% / 75%) over the non-zero totals; [0, 0, 0] with fewer than two (a lone day is level 4). */
export function thresholds(totals) {
    const sorted = totals.filter((n) => n > 0).sort((a, b) => a - b);
    if (sorted.length < 2) return [0, 0, 0];
    return [0.25, 0.5, 0.75].map((p) => sorted[Math.floor(p * (sorted.length - 1))]);
}

/** Colour level 0..4 for a day's total: 0 is empty, 4 is above the third cut-off. */
export function levelOf(total, [q1, q2, q3]) {
    if (!(total > 0)) return 0;
    if (total <= q1) return 1;
    if (total <= q2) return 2;
    if (total <= q3) return 3;
    return 4;
}

/** Monday-first week columns ending in today's week; days after today are null, month is set where a 1st falls. */
export function heatmapWeeks(byDay, today, weeks = 53) {
    const cuts = thresholds([...byDay.values()].map((d) => d.total));
    const sinceMonday = (today.getDay() + 6) % 7;
    const start = addDays(today, -sinceMonday - (weeks - 1) * 7);
    const todayKey = localDay(today.getTime());
    const columns = [];
    for (let w = 0; w < weeks; w++) {
        const days = [];
        let month = null;
        for (let i = 0; i < 7; i++) {
            const date = addDays(start, w * 7 + i);
            const day = localDay(date.getTime());
            if (date.getDate() === 1) month = `${date.getMonth() + 1}月`;
            if (day > todayKey) {
                days.push(null);
                continue;
            }
            const total = byDay.get(day)?.total || 0;
            days.push({ day, total, level: levelOf(total, cuts) });
        }
        if (w === 0 && month === null) month = `${addDays(start, 0).getMonth() + 1}月`;
        columns.push({ month, days });
    }
    return columns;
}

/** Compact token count: thousands separators, then 万 and 亿 units. */
export function formatTokens(n) {
    const trim = (x) => String(Number(x.toFixed(1)));
    if (n < 1e4) return n.toLocaleString('en-US');
    if (n < 1e6) return `${trim(n / 1e4)} 万`;
    if (Math.round(n / 1e4) < 1e4) return `${Math.round(n / 1e4).toLocaleString('en-US')} 万`;
    return `${trim(n / 1e8)} 亿`;
}
