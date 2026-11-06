// When a message was sent, as the chat shows it.

const pad = (n) => String(n).padStart(2, '0');
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "14:32" today, "昨天 14:32", "11月5日 14:32" this year, "2025年11月5日 14:32" before. */
export function messageTime(ms, now = Date.now()) {
    if (!ms || !Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const today = new Date(now);
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const days = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
    if (days === 0) return clock;
    if (days === 1) return `昨天 ${clock}`;
    if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
}
