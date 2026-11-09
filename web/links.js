// Links a session mentions, gathered for the side panel: MRs / PRs, Feishu
// documents and the rest. Only what the person and the agent wrote counts;
// tool calls and their output are not looked at.

import { Marked } from './node_modules/marked/lib/marked.esm.js';

const marked = new Marked({ gfm: true });

// GFM autolinks stop at whitespace, so a bare URL swallows the Chinese
// punctuation (and the words) right after it.
const CJK_PUNCT = /[。，、；：！？（）【】「」『』《》〈〉…—“”‘’]/;

/** Without its #fragment and trailing slash: one entry per page. */
export function normalizeUrl(url) {
    return url.replace(/#.*$/, '').replace(/\/+$/, '');
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
            const cut = url.search(CJK_PUNCT);
            if (cut >= 0) url = url.slice(0, cut);
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
const isNumber = (s) => /^\d+$/.test(s ?? '');

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
    let label = text || (host + u.pathname).replace(/\/+$/, '');
    if (label.length > LABEL_MAX) label = `${label.slice(0, LABEL_MAX - 1)}…`;
    return { kind: 'other', label };
}
