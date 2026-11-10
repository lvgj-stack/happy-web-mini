// node --test: links in a session, gathered for the side panel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLink, extractLinks, joinRanges, linkTracker, normalizeUrl, scanHistory } from '../links.js';

test('extract: markdown links keep their text, bare URLs have none', () => {
    assert.deepEqual(extractLinks('看 [需求 Spec](https://x.feishu.cn/docx/AbC123) 和 https://github.com/a/b/pull/3'), [
        { url: 'https://x.feishu.cn/docx/AbC123', text: '需求 Spec' },
        { url: 'https://github.com/a/b/pull/3', text: null },
    ]);
    assert.deepEqual(extractLinks('[https://a.com/x](https://a.com/x)'), [{ url: 'https://a.com/x', text: null }], 'text equal to url is no text');
});

test('extract: code is skipped, only http(s), trailing punctuation dropped', () => {
    assert.deepEqual(extractLinks('```\nhttps://a.com/in-block\n```\n`https://a.com/inline` mailto:a@b.c ftp://a.com/f'), []);
    assert.deepEqual(extractLinks('见 https://x.feishu.cn/docx/AbC123。'), [{ url: 'https://x.feishu.cn/docx/AbC123', text: null }]);
    assert.deepEqual(extractLinks('(https://github.com/a/b/pull/3)'), [{ url: 'https://github.com/a/b/pull/3', text: null }]);
    assert.deepEqual(extractLinks('列表\n- 链接：https://a.com/p，然后'), [{ url: 'https://a.com/p', text: null }]);
});

test('extract: a closing paren before Chinese punctuation or text is not part of the URL', () => {
    assert.deepEqual(extractLinks('MR 在这 (https://github.com/a/b/pull/3)。'), [{ url: 'https://github.com/a/b/pull/3', text: null }]);
    assert.deepEqual(extractLinks('文档(https://x.feishu.cn/wiki/Q1)里'), [{ url: 'https://x.feishu.cn/wiki/Q1', text: null }]);
    assert.deepEqual(extractLinks('见 https://a.com/x.，然后'), [{ url: 'https://a.com/x', text: null }]);
    assert.deepEqual(extractLinks('https://en.wikipedia.org/wiki/A_(b)。'), [{ url: 'https://en.wikipedia.org/wiki/A_(b)', text: null }], 'balanced parens stay');
});

test('normalize: a hash route is part of the page', () => {
    assert.equal(normalizeUrl('https://tool.example.com/#/task/123'), 'https://tool.example.com/#/task/123');
    assert.equal(normalizeUrl('https://tool.example.com/#!/task/1'), 'https://tool.example.com/#!/task/1');
});

test('normalize: fragment and trailing slash', () => {
    assert.equal(normalizeUrl('https://a.com/x/#h'), 'https://a.com/x');
    assert.equal(normalizeUrl('https://a.com/x?q=1#h'), 'https://a.com/x?q=1');
});

test('classify: MR / PR', () => {
    assert.deepEqual(classifyLink('https://code.byted.org/seed/fe_mono/merge_requests/1234', 'MR'), { kind: 'mr', label: 'fe_mono !1234' });
    assert.deepEqual(classifyLink('https://gitlab.com/g/sub/repo/-/merge_requests/7', null), { kind: 'mr', label: 'repo !7' });
    assert.deepEqual(classifyLink('https://github.com/o/r/pull/42/files', null), { kind: 'mr', label: 'r #42' });
});

test('classify: Feishu / Lark documents', () => {
    assert.deepEqual(classifyLink('https://bytedance.larkoffice.com/docx/AbCdEf123', '需求 Spec'), { kind: 'doc', label: '需求 Spec' });
    assert.deepEqual(classifyLink('https://x.feishu.cn/wiki/QwErTy999', null), { kind: 'doc', label: 'Wiki QwErTy' });
    assert.equal(classifyLink('https://a.larksuite.com/sheets/S1', null).label, '表格 S1');
    assert.equal(classifyLink('https://feishu.cn/base/B1', null).label, '多维表格 B1');
    assert.equal(classifyLink('https://x.feishu-boe.cn/mindnotes/M1', null).label, '思维笔记 M1');
    assert.equal(classifyLink('https://x.feishu.cn/slides/P1', null).label, '幻灯片 P1');
    assert.equal(classifyLink('https://x.feishu.cn/docs/D1', null).label, '文档 D1');
    assert.equal(classifyLink('https://x.feishu.cn/drive/folder/F1', null).kind, 'other', 'not a document path');
    assert.equal(classifyLink('https://notfeishu.cn/docx/X', null).kind, 'other', 'suffix must match a whole label');
});

test('classify: other', () => {
    assert.deepEqual(classifyLink('https://www.npmjs.com/package/marked', null), { kind: 'other', label: 'www.npmjs.com/package/marked' });
    assert.deepEqual(classifyLink('https://a.com/x', '设计稿'), { kind: 'other', label: '设计稿' });
    assert.ok(classifyLink(`https://a.com/${'x'.repeat(200)}`, null).label.length <= 60);
});

const user = (text, at = 1) => ({ kind: 'user', text, at });
const agent = (text, at = 1) => ({ kind: 'agent', text, at });
const MR = 'https://code.byted.org/g/fe_mono/merge_requests/9';

test('tracker: earliest wins in any order, one count per seq, normalized', () => {
    const t = linkTracker();
    assert.deepEqual(t.see(agent(`建好了 ${MR}`, 50), 50), [MR]);
    assert.deepEqual(t.see(user(`看 ${MR}/ 和 ${MR}#x`, 10), 10), [], 'already known');
    t.see(user(`看 ${MR}/ 和 ${MR}#x`, 10), 10); // same seq again (loadOlder + scan)
    t.see({ kind: 'thinking', text: MR }, 60);
    t.see({ kind: 'tool', text: MR }, 61);
    assert.deepEqual(t.list(), [{ kind: 'mr', items: [{ url: MR, label: 'fe_mono !9', who: 'user', at: 10, seq: 10, count: 2 }] }]);
});

test('classify: Meego work items', () => {
    assert.deepEqual(classifyLink('https://meego.feishu.cn/merlin/story/detail/7336922231', null), { kind: 'meego', label: '需求 7336922231' });
    assert.deepEqual(classifyLink('https://meego.feishu.cn/merlin/issue/detail/42?parentUrl=x', '登录报错'), { kind: 'meego', label: '登录报错' });
    assert.deepEqual(classifyLink('https://project.feishu.cn/space/epic/detail/9', null), { kind: 'meego', label: 'epic 9' });
    assert.deepEqual(classifyLink('https://meego.feishu.cn/merlin', null), { kind: 'meego', label: 'meego.feishu.cn/merlin' });
    assert.equal(classifyLink('https://x.feishu.cn/docx/D1', null).kind, 'doc', 'a document is still a document');
});

test('tracker: groups in order, label from the earliest text, restores from JSON', () => {
    const t = linkTracker();
    t.see(agent('https://a.com/z'), 3);
    t.see(user('[Spec](https://x.feishu.cn/docx/D1)'), 2);
    t.see(agent(MR), 1);
    t.see(agent('https://meego.feishu.cn/merlin/story/detail/1'), 4);
    assert.deepEqual(t.list().map((g) => g.kind), ['mr', 'doc', 'meego', 'other']);
    assert.equal(t.list()[1].items[0].label, 'Spec');
    const back = linkTracker({ links: JSON.parse(JSON.stringify(t.toJSON())) });
    assert.deepEqual(back.list(), t.list());
    back.see(agent(MR), 1);
    assert.equal(back.list()[0].items[0].count, 1, 'a restored seq is not counted again');
});

test('tracker: a bare earliest mention borrows a later link text', () => {
    const t = linkTracker();
    t.see(agent('[需求 Spec](https://x.feishu.cn/docx/D1)'), 9);
    t.see(user('https://x.feishu.cn/docx/D1'), 2);
    assert.deepEqual(t.list()[0].items[0], { url: 'https://x.feishu.cn/docx/D1', label: '需求 Spec', who: 'user', at: 1, seq: 2, count: 2 });
    t.see(agent('[旧名](https://x.feishu.cn/docx/D1)'), 1);
    assert.equal(t.list()[0].items[0].label, '旧名', 'the earliest text wins');
});

test('joinRanges: overlapping or adjacent only', () => {
    assert.deepEqual(joinRanges({ from: 5, to: 10 }, { from: 11, to: 20 }), { from: 5, to: 20 });
    assert.deepEqual(joinRanges({ from: 5, to: 10 }, { from: 1, to: 7 }), { from: 1, to: 10 });
    assert.equal(joinRanges({ from: 5, to: 10 }, { from: 12, to: 20 }), null);
});

// History of seqs 1..n; each message mentions one URL.
const history = (n) => {
    const calls = [];
    const fetchPage = async (before) => {
        calls.push(before);
        const rows = [];
        for (let s = Math.max(1, before - 3); s < Math.min(before, n + 1); s++) rows.push({ seq: s, view: agent(`https://a.com/${s}`) });
        return { rows, hasMore: rows.length > 0 && rows[0].seq > 1 };
    };
    return { calls, fetchPage };
};

test('scan: no cache pages back to the start, saving as it goes', async () => {
    const { calls, fetchPage } = history(20);
    const tracker = linkTracker();
    const saves = [];
    const r = await scanHistory({ tracker, loaded: { from: 11, to: 20, hasOlder: true }, cache: null, fetchPage, save: (c) => saves.push(c), alive: () => true });
    assert.equal(r.complete, true);
    assert.deepEqual(calls, [11, 8, 5, 2]);
    assert.equal(tracker.size, 10);
    assert.deepEqual(saves.at(-1), { from: 0, to: 20, complete: true });
});

test('scan: a first page with nothing older needs no request', async () => {
    const { calls, fetchPage } = history(5);
    const saves = [];
    const r = await scanHistory({ tracker: linkTracker(), loaded: { from: 1, to: 5, hasOlder: false }, cache: null, fetchPage, save: (c) => saves.push(c), alive: () => true });
    assert.equal(r.complete, true);
    assert.deepEqual(calls, []);
    assert.deepEqual(saves, [{ from: 0, to: 5, complete: true }]);
});

test('scan: fills only the gap to a complete cache', async () => {
    const { calls, fetchPage } = history(30);
    const saves = [];
    await scanHistory({ tracker: linkTracker(), loaded: { from: 21, to: 30, hasOlder: true }, cache: { from: 0, to: 15, complete: true }, fetchPage, save: (c) => saves.push(c), alive: () => true });
    assert.deepEqual(calls, [21, 18], 'stops once it reaches seq 15');
    assert.deepEqual(saves.at(-1), { from: 0, to: 30, complete: true });
});

test('scan: an incomplete cache continues below its start', async () => {
    const { calls, fetchPage } = history(30);
    await scanHistory({ tracker: linkTracker(), loaded: { from: 21, to: 30, hasOlder: true }, cache: { from: 10, to: 20, complete: false }, fetchPage, save: () => {}, alive: () => true });
    assert.deepEqual(calls, [10, 7, 4]);
});

test('scan: a failure before reaching the cache keeps the cached range', async () => {
    const saves = [];
    const fetchPage = async () => { throw new Error('net'); };
    await assert.rejects(scanHistory({ tracker: linkTracker(), loaded: { from: 21, to: 30, hasOlder: true }, cache: { from: 0, to: 15, complete: true }, fetchPage, save: (c) => saves.push(c), alive: () => true }));
    assert.deepEqual(saves, [], 'nothing saved that would shrink the cache');
});

test('scan: stops quietly when no longer alive', async () => {
    const { calls, fetchPage } = history(20);
    let n = 0;
    const r = await scanHistory({ tracker: linkTracker(), loaded: { from: 11, to: 20, hasOlder: true }, cache: null, fetchPage, save: () => {}, alive: () => n++ < 1 });
    assert.equal(r.complete, false);
    assert.equal(calls.length, 1);
});
