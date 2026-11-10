// Links a session mentions, gathered for the side panel: MRs / PRs, Feishu
// documents, Meego work items and the rest. Only what the person and the agent wrote counts;
// tool calls and their output are not looked at.

import { Marked } from './node_modules/marked/lib/marked.esm.js';

const marked = new Marked({ gfm: true });

// GFM autolinks stop at whitespace, so a bare URL swallows the Chinese
// (punctuation or words) right after it; a pasted URL has its own encoded.
const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef…—“”‘’]/;

/** GFM's trailing rule, again after the cut: no end punctuation, no unmatched ")". */
function trimEnd(url) {
    for (;;) {
        const last = url.at(-1);
        if ('?!.,:*_~\'"'.includes(last)) url = url.slice(0, -1);
        else if (last === ')' && url.split('(').length < url.split(')').length) url = url.slice(0, -1);
        else return url;
    }
}

/** Without its #fragment (a #/ or #! route is kept: it is the page) and trailing slash: one entry per page. */
export function normalizeUrl(url) {
    return url.replace(/#(?![/!]).*$/, '').replace(/\/+$/, '');
}

/** Links in markdown, in order: `text` is the link text when it says more than the URL. Code is skipped. */
export function extractLinks(markdown) {
    const out = [];
    if (!markdown) return out;
    marked.walkTokens(marked.lexer(markdown), (token) => {
        if (token.type !== 'link') return;
        const bare = !token.raw.startsWith('[') && !token.raw.startsWith('<');
        let url = token.href;
        if (bare) {
            const cut = url.search(CJK);
            if (cut >= 0) url = trimEnd(url.slice(0, cut));
        }
        if (!/^https?:\/\/[^/]/i.test(url)) return;
        const text = bare ? null : token.text?.trim();
        out.push({ url, text: text && text !== url ? text : null });
    });
    return out;
}

const FEISHU_HOSTS = ['feishu.cn', 'larkoffice.com', 'larksuite.com', 'feishu-boe.cn'];
const DOC_KINDS = { docx: '文档', docs: '文档', wiki: 'Wiki', sheets: '表格', base: '多维表格', mindnotes: '思维笔记', slides: '幻灯片' };
const LABEL_MAX = 60;
// Meego (飞书项目): meego.feishu.cn/<space>/<type>/detail/<id>.
const MEEGO_HOSTS = ['meego.feishu.cn', 'project.feishu.cn', 'meego.larkoffice.com', 'project.larkoffice.com', 'meegle.com'];
const MEEGO_KINDS = { story: '需求', issue: '缺陷', task: '任务', version: '版本', sprint: '迭代' };
const isNumber = (s) => /^\d+$/.test(s ?? '');
const clip = (label) => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label);

/** Which group a link goes in, and the name it is shown by. */
export function classifyLink(url, text) {
    let u;
    try { u = new URL(url); } catch { return { kind: 'other', label: text || url }; }
    const host = u.hostname.toLowerCase();
    const segs = u.pathname.split('/').filter(Boolean);

    const mr = segs.indexOf('merge_requests');
    if (mr > 0 && isNumber(segs[mr + 1])) {
        const repo = segs[mr - 1] === '-' ? segs[mr - 2] : segs[mr - 1];
        if (repo) return { kind: 'mr', label: `${repo} !${segs[mr + 1]}` };
    }
    if (host === 'github.com' && segs[2] === 'pull' && isNumber(segs[3])) {
        return { kind: 'mr', label: `${segs[1]} #${segs[3]}` };
    }
    if (FEISHU_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) && DOC_KINDS[segs[0]] && segs[1]) {
        return { kind: 'doc', label: text || `${DOC_KINDS[segs[0]]} ${segs[1].slice(0, 6)}` };
    }
    if (MEEGO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
        const item = segs[2] === 'detail' && isNumber(segs[3]) ? `${MEEGO_KINDS[segs[1]] ?? segs[1]} ${segs[3]}` : null;
        return { kind: 'meego', label: clip(text || item || (host + u.pathname).replace(/\/+$/, '')) };
    }
    return { kind: 'other', label: clip(text || (host + u.pathname).replace(/\/+$/, '')) };
}

const KINDS = ['mr', 'doc', 'meego', 'other'];

/**
 * Links seen so far, one entry per page. Messages arrive in any order (the
 * newest page first, older ones later, some twice): the earliest mention is
 * where a link came from, and each message counts once.
 * `cached`: what toJSON() gave, to start from.
 */
export function linkTracker(cached) {
    const links = new Map(); // url -> { seq, who, at, text, seqs: Set }
    for (const [url, e] of Object.entries(cached?.links ?? {})) {
        links.set(url, { seq: e.seq, who: e.who, at: e.at ?? null, text: e.text ?? null, seqs: new Set(e.seqs ?? [e.seq]) });
    }
    return {
        /** Feed one decoded message; returns the URLs it brought in for the first time. */
        see(view, seq) {
            if (view?.kind !== 'user' && view?.kind !== 'agent') return [];
            const fresh = [];
            for (const { url: raw, text } of extractLinks(view.text)) {
                const url = normalizeUrl(raw);
                let e = links.get(url);
                if (!e) {
                    e = { seq: Infinity, who: null, at: null, text: null, seqs: new Set() };
                    links.set(url, e);
                    fresh.push(url);
                }
                e.seqs.add(seq);
                // The earliest mention's text, else any mention's: a bare URL says less.
                if (seq < e.seq) {
                    Object.assign(e, { seq, who: view.kind, at: view.at ?? null });
                    if (text) e.text = text;
                } else if (!e.text && text) {
                    e.text = text;
                }
            }
            return fresh;
        },
        /** Groups in panel order, empty ones left out; each sorted by first mention. */
        list() {
            const groups = new Map(KINDS.map((k) => [k, []]));
            for (const [url, e] of links) {
                const { kind, label } = classifyLink(url, e.text);
                groups.get(kind).push({ url, label, who: e.who, at: e.at, seq: e.seq, count: e.seqs.size });
            }
            return KINDS.filter((k) => groups.get(k).length)
                .map((kind) => ({ kind, items: groups.get(kind).sort((a, b) => a.seq - b.seq) }));
        },
        toJSON() {
            const out = {};
            for (const [url, e] of links) out[url] = { seq: e.seq, who: e.who, at: e.at, text: e.text, seqs: [...e.seqs] };
            return out;
        },
        get size() { return links.size; },
    };
}

/** The union of two seq ranges that touch or overlap, else null. */
export function joinRanges(a, b) {
    if (b.from > a.to + 1 || a.from > b.to + 1) return null;
    return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
}

/**
 * Feed every message older than what is loaded into `tracker`, page by page,
 * skipping what `cache` already covers. A range { from, to } means every
 * message with a seq in it has been fed; one page fetched with before_seq=X
 * covers [its oldest seq, X - 1], down to 0 when nothing is older.
 * `save` gets the covered range whenever it grows, but only once it joins
 * the cache (a smaller range must not replace it). Rejects when a page fails.
 */
export async function scanHistory({ tracker, loaded, cache, fetchPage, save, alive }) {
    let covered = { from: loaded.hasOlder ? loaded.from : 0, to: loaded.to };
    let complete = !loaded.hasOlder;
    let saved = null;
    for (;;) {
        const joined = cache && joinRanges(covered, cache);
        if (joined) {
            covered = joined;
            complete ||= !!cache.complete;
            cache = null;
        }
        if (!cache) {
            const next = { ...covered, complete };
            const key = JSON.stringify(next);
            if (key !== saved) { saved = key; save(next); }
        }
        if (complete || !alive()) return { complete };
        const { rows, hasMore } = await fetchPage(covered.from);
        for (const { seq, view } of rows) tracker.see(view, seq);
        complete = !hasMore || rows.length === 0;
        covered = { from: complete ? 0 : rows[0].seq, to: covered.to };
    }
}
