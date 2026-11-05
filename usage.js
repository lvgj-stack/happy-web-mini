// Plan usage limits a Claude session reports in agentState.usageLimits
// ({ capturedAt, windows: [{ id, label?, status?, utilization?, resetsAt? }] }).
// Mirrors iOS SessionComposerRules.usageLimitRows: 5h and 7d first.

const KNOWN = ['five_hour', 'seven_day'];
const NAMES = {
    five_hour: '5 小时',
    seven_day: '7 天',
    seven_day_opus: '7 天 Opus',
    seven_day_sonnet: '7 天 Sonnet',
    seven_day_oauth_apps: '7 天 应用',
};

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function windowName(w) {
    return NAMES[w.id] ?? (w.label || String(w.id).replace(/_/g, ' '));
}

/** 'ok' | 'warn' | 'over' from the window's status, else from its percent. */
function level(status, percent) {
    if (status === 'rejected' || (percent != null && percent >= 100)) return 'over';
    if (status === 'allowed_warning' || (percent != null && percent >= 90)) return 'warn';
    return 'ok';
}

function formatTime(ms, now) {
    const d = new Date(ms);
    const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const today = new Date(now);
    if (d.toDateString() === today.toDateString()) return hm;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * What the composer shows, or null when the session reports nothing.
 * { rows: [{ id, name, percent|null, level, resetsAt|null, reset }], capturedAt }
 * A window whose reset time has passed is marked `reset`: its numbers are from before.
 */
export function usageRows(limits, now = Date.now()) {
    const windows = Array.isArray(limits?.windows) ? limits.windows : [];
    const rank = (w) => (KNOWN.includes(w.id) ? KNOWN.indexOf(w.id) : KNOWN.length);
    const rows = windows
        .filter((w) => w && typeof w.id === 'string')
        .map((w, i) => ({ w, i }))
        .sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i)
        .map(({ w }) => {
            const u = finite(w.utilization);
            const percent = u == null ? null : Math.round(Math.min(100, Math.max(0, u)));
            const resetsAt = finite(w.resetsAt);
            const reset = resetsAt != null && resetsAt <= now;
            return { id: w.id, name: windowName(w), percent, level: reset ? 'ok' : level(w.status, percent), resetsAt, reset };
        })
        .filter((r) => r.percent != null || r.level !== 'ok' || r.reset);
    if (rows.length === 0) return null;
    return { rows, capturedAt: finite(limits.capturedAt) };
}

/** The short inline text for one row: "5 小时 42%", "7 天 已用尽". */
export function rowText(r) {
    if (r.reset) return `${r.name} 已重置`;
    if (r.percent != null) return `${r.name} ${r.percent}%`;
    return `${r.name} ${r.level === 'over' ? '已用尽' : '接近上限'}`;
}

/** The tooltip: every window with its reset time, then when it was measured. */
export function usageTooltip(usage, now = Date.now()) {
    const lines = usage.rows.map((r) => {
        if (r.reset) return `${r.name}：上次 ${r.percent ?? '?'}%，已在 ${formatTime(r.resetsAt, now)} 重置`;
        const used = r.percent != null ? `已用 ${r.percent}%` : (r.level === 'over' ? '已用尽' : '接近上限');
        return r.resetsAt != null ? `${r.name}：${used}，${formatTime(r.resetsAt, now)} 重置` : `${r.name}：${used}`;
    });
    if (usage.capturedAt) lines.push(`截至 ${formatTime(usage.capturedAt, now)}（每轮对话后更新）`);
    return lines.join('\n');
}

export const capturedText = (usage, now = Date.now()) => (usage.capturedAt ? `截至 ${formatTime(usage.capturedAt, now)}` : '');
