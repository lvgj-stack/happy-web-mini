// Token usage per reply, summed per local day, from a session's decrypted messages.
//
// Protocol sources:
// - happy-wire/src/sessionProtocol.ts, `sessionEnvelopeSchema.usage`: an agent
//   envelope may carry { input_tokens, cache_creation_input_tokens,
//   cache_read_input_tokens, output_tokens }.
// - happy-cli claude/utils/sessionProtocolMapper.ts, `attachUsageToLastEnvelope`:
//   Claude's usage rides on the last envelope of a message.
// - happy-cli codex/utils/sessionProtocolMapper.ts, `token_count`: Codex sends a
//   usage-only `service` envelope (no turn).
// Older CLIs sent Claude's raw messages (role "agent", content type "output").
//
// Claude Code writes one JSONL line per content block, and every line of one
// API reply (same `message.id`) repeats the same usage; the envelope does not
// keep the id. So a reply is keyed by turn + subagent + the four numbers, and a
// key seen before is not counted again. Unlike context.js, subagents count: they
// spend tokens too.

import { localDay } from './time.js';

const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * { key, input, output, cacheWrite, cacheRead, time|null } from one decrypted
 * record, or null when it carries no usage. `key` identifies the reply.
 */
export function replyUsage(raw) {
    const content = raw?.content;
    let usage = null;
    let prefix = null;
    let time = null;
    let id = null;
    if (raw?.role === 'session') {
        const env = content?.type === 'session' ? content.data : content;
        if (env?.role === 'agent') {
            usage = env.usage;
            prefix = ['s', env.turn ?? '', env.subagent ?? ''];
            time = Number.isFinite(env.time) ? env.time : null;
        }
    } else if (raw?.role === 'agent' && content?.type === 'output') {
        const data = content.data;
        if (data?.type === 'assistant') {
            usage = data.message?.usage;
            prefix = ['m'];
            id = typeof data.message?.id === 'string' && data.message.id ? data.message.id : null;
            const t = Date.parse(data.timestamp);
            time = Number.isFinite(t) ? t : null;
        }
    }
    if (!usage || typeof usage !== 'object' || !Number.isFinite(usage.input_tokens)) return null;
    const input = count(usage.input_tokens);
    const output = count(usage.output_tokens);
    const cacheWrite = count(usage.cache_creation_input_tokens);
    const cacheRead = count(usage.cache_read_input_tokens);
    const key = id ? `m|${id}` : [...prefix, input, output, cacheWrite, cacheRead].join('|');
    return { key, input, output, cacheWrite, cacheRead, time };
}

const validEdge = (e) => Array.isArray(e) && Number.isFinite(e[0]) && typeof e[1] === 'string';

/**
 * Running per-day totals for one session: days['YYYY-MM-DD'] = [input, output,
 * cacheWrite, cacheRead]. `cached`: what toJSON() gave, to start from. Replies
 * are deduplicated by key within this run; across runs only the keys at the
 * edges (smallest and largest seq counted) are remembered, which is where a
 * reply split over messages meets the next or previous page.
 */
export function tokenStats(cached) {
    const days = {};
    if (cached?.days && typeof cached.days === 'object') {
        for (const [day, v] of Object.entries(cached.days)) {
            if (Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) days[day] = [...v];
        }
    }
    let min = validEdge(cached?.edge?.min) ? [...cached.edge.min] : null;
    let max = validEdge(cached?.edge?.max) ? [...cached.edge.max] : null;
    const seen = new Set([min?.[1], max?.[1]].filter(Boolean));
    return {
        /** Feed one record ({ seq, createdAt } is its row); true when the totals changed. */
        see(raw, row) {
            const r = replyUsage(raw);
            if (!r || seen.has(r.key)) return false;
            const ms = Number.isFinite(row?.createdAt) ? row.createdAt : r.time;
            if (!Number.isFinite(ms)) return false;
            seen.add(r.key);
            const d = (days[localDay(ms)] ??= [0, 0, 0, 0]);
            d[0] += r.input;
            d[1] += r.output;
            d[2] += r.cacheWrite;
            d[3] += r.cacheRead;
            const seq = row?.seq;
            if (Number.isFinite(seq)) {
                if (!min || seq < min[0]) min = [seq, r.key];
                if (!max || seq > max[0]) max = [seq, r.key];
            }
            return true;
        },
        days,
        toJSON() { return { days, edge: { min, max } }; },
    };
}
