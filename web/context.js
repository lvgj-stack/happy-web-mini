// How full the agent's context is, from the token usage its replies carry.
//
// Happy CLI puts the model's usage on the last envelope of each agent message
// (`usage`: input / cache_creation / cache_read / output tokens). From the
// second turn of a Claude session on it also stamps `context_window`, the
// model's real limit the SDK reported (200K, 1M, …); Codex reports it too.
// A subagent's envelopes carry its own usage, not the session's: skipped.
// Older CLIs sent Claude's raw messages (role "agent", content type "output").

const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

/** { used, window|null } from one decrypted record, or null when it carries none. */
export function contextUsage(raw) {
    const content = raw?.content;
    let usage = null;
    if (raw?.role === 'session') {
        const env = content?.type === 'session' ? content.data : content;
        if (env?.role === 'agent' && !env.subagent) usage = env.usage;
    } else if (raw?.role === 'agent' && content?.type === 'output') {
        const data = content.data;
        if (data?.type === 'assistant' && !data.isSidechain && !data.parent_tool_use_id) usage = data.message?.usage;
    }
    if (!usage || typeof usage !== 'object' || !Number.isFinite(usage.input_tokens)) return null;
    // What the model read for this reply; its output joins the context from the next one.
    const used = count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens);
    const window = Number.isFinite(usage.context_window) && usage.context_window > 0 ? usage.context_window : null;
    return { used, window };
}

/** "8.2K", "74K", "1.2M" */
export function tokens(n) {
    if (n < 1000) return String(n);
    if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * { text, level, title } for the composer: "上下文剩 63%", or "上下文 74K"
 * while the window is unknown. level: ok | warn (≤ 25% left) | over (≤ 10%).
 */
export function contextLine({ used, window }) {
    if (!window) return { text: `上下文 ${tokens(used)}`, level: 'ok', title: `上下文：已用 ${tokens(used)} tokens（第一轮结束后才知道窗口多大）` };
    const left = Math.max(0, Math.min(100, Math.round((1 - used / window) * 100)));
    const level = left <= 10 ? 'over' : left <= 25 ? 'warn' : 'ok';
    return { text: `上下文剩 ${left}%`, level, title: `上下文：已用 ${tokens(used)} / ${tokens(window)} tokens，剩 ${left}%` };
}
