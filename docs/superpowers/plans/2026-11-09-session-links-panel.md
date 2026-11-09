# 会话右栏链接汇总 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会话页右栏自动汇总会话里出现过的 MR/PR、飞书文档和其他链接，可直接打开、可跳回原文。

**Architecture:** 纯逻辑放进新模块 `web/links.js`（提取、分类、去重 tracker、区间合并、可注入取数函数的历史扫描），在 node 里测试；`web/app.js` 只做接线（喂消息、缓存读写、启动扫描、渲染右栏、跳转），`web/index.html` 加右栏的 DOM 和 CSS。

**Tech Stack:** 无构建的原生 ES modules；marked 15（`./node_modules/marked/lib/marked.esm.js`）；`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-09-session-links-panel-design.md`

## Global Constraints

- 只改 `web/`；commit scope 用 `web`，subject 形如 `feat(web): …`，正文末尾带 Claude Code / Happy 署名（见 CLAUDE.md）
- 不加新依赖；marked 的 import 路径和 `web/markdown.js` 一致
- 只从用户消息（`view.kind === 'user'`）和 agent 文字（`view.kind === 'agent'`）取链接；工具输入输出、thinking、`output`、`meta` 一律不看
- 只收 http(s)；代码块、行内代码里的 URL 不收
- 缓存键 `happy.links.<会话 id>`，结构 `{ v: 1, from, to, complete, links }`；隐藏开关 `happy.linksHidden`
- 折叠键（复用 `state.collapsed` / `happy.collapsed`）：`links:mr`、`links:doc` 在集合中 = 折叠；`links:other` 在集合中 = **展开**
- 右栏宽 260px、离右边缘 24px；常驻断点为主区宽度 ≥ 1476px（860 + 2 × (260 + 2 × 24)）
- 文案：标题「链接 · N」；分组「MR / PR」「飞书文档」「其他链接」；来源「你」/「agent」；「提到 N 次」（N=1 不显示）；「正在查找更早的消息…」；「更早的消息未扫完 · 重试」；「正在载入…」

## Review Focus

1. 同一条消息里同一个 URL 出现两次，或同一 seq 被 `loadOlder` 和扫描各喂一次 → 「提到 N 次」不能虚高（Task 2 测试）
2. URL 后紧跟中文标点或右括号（`见 https://x.feishu.cn/docx/AbC123。`、`(https://github.com/a/b/pull/3)`）→ 提取出的 URL 不含标点（Task 1 测试）
3. 缓存存在但与本次已载入范围之间有空档、且扫描中途失败 → 不能把缓存区间覆盖成更小的区间，下次能接着补（Task 2 测试）
4. 会话只有不到一页消息（`hasMore: false` 于首页）→ 不发任何扫描请求，直接 `complete`（Task 2 测试）
5. 跳回的原文在折叠的「已工作」轮次里、且还没载入 → 先加载、再展开、再滚动（Task 4 手动验证）

---

### Task 1: 链接提取和分类

**Files:**
- Create: `web/links.js`
- Test: `web/test/links.test.mjs`
- 先在 worktree 准备依赖：`ln -s /Users/lvgj/code/agentic/happy-web-mini/web/node_modules web/node_modules`（已被 gitignore）

**Interfaces:**
- Produces:
  - `normalizeUrl(url: string) -> string`：去 `#` 片段、去末尾 `/`
  - `extractLinks(markdown: string) -> Array<{ url: string, text: string | null }>`：`text` 为与 URL 不同的链接文字，否则 `null`；顺序同原文；不去重
  - `classifyLink(url: string, text: string | null) -> { kind: 'mr' | 'doc' | 'other', label: string }`

- [ ] **Step 1: 写失败的测试** `web/test/links.test.mjs`

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLink, extractLinks, normalizeUrl } from '../links.js';

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
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && node --test test/links.test.mjs`
Expected: FAIL（`Cannot find module '../links.js'`）

- [ ] **Step 3: 实现 `web/links.js` 的三个函数**

用 `new Marked({ gfm: true })` 的 `lexer` + `walkTokens`（或自己递归 `tokens`/`items`），收 `type === 'link'` 的 token，不进 `code` / `codespan`。GFM 自动链接已会剥掉末尾的 `.` `,` `)` 等 ASCII 标点，但中文标点（`。，；：！？）」`）和其后的文字会被吃进裸 URL：对 `token.text === token.href` 的裸链接，在第一个中文标点处截断。飞书域名判断：主机等于或以 `.` + 域名结尾（`feishu.cn` `larkoffice.com` `larksuite.com` `feishu-boe.cn`）。路径首段 → 名称：`docx`/`docs` 文档、`wiki` Wiki、`sheets` 表格、`base` 多维表格、`mindnotes` 思维笔记、`slides` 幻灯片；token 取路径第二段前 6 位。MR 仓库名取 `merge_requests` 前（跳过 `-`）最后一段；GitHub 取路径第 2 段。「其他」无文字时为 `host + pathname`（去末尾 `/`），超过 60 字符截到 59 加 `…`。

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && node --test test/links.test.mjs`
Expected: PASS（6 个测试）

- [ ] **Step 5: 提交**

```bash
git add web/links.js web/test/links.test.mjs
git commit   # feat(web): 提取和分类会话中的链接
```

---

### Task 2: 去重 tracker、区间合并和历史扫描

**Files:**
- Modify: `web/links.js`
- Test: `web/test/links.test.mjs`（追加）

**Interfaces:**
- Consumes: Task 1 的 `extractLinks` / `classifyLink` / `normalizeUrl`
- Produces:
  - `linkTracker(cached?: { links }) -> { see(view, seq) -> string[], list(), toJSON(), size }`
    - `see`：`view` 为 app.js 的解码视图（`{ kind, text, at? }`），只处理 `kind` 为 `'user'`/`'agent'`；返回本次**新出现**的规范化 URL 列表
    - `list() -> Array<{ kind, items: Array<{ url, label, who: 'user'|'agent', at, seq, count }> }>`：按 `mr`、`doc`、`other` 顺序，空组不返回，组内按 `seq` 升序；`label` 由最早那次的文字算
    - `toJSON() -> { [url]: { seq, who, at, text, seqs: number[] } }`
  - `joinRanges(a: {from,to}, b: {from,to}) -> {from,to} | null`：`b.from <= a.to + 1 && a.from <= b.to + 1` 时返回并集
  - `scanHistory({ tracker, loaded, cache, fetchPage, save, alive }) -> Promise<{ complete: boolean }>`
    - `loaded: { from, to, hasOlder }`：页面已载入的连续区间（`thread.oldestSeq`、`thread.afterSeq`、`thread.hasOlder`）
    - `cache: { from, to, complete } | null`
    - `fetchPage(beforeSeq) -> Promise<{ rows: Array<{ seq, view }>, hasMore }>`，`rows` 按 seq 升序
    - `save({ from, to, complete })`：每次覆盖区间扩展后调用（调用方据此连同 `tracker.toJSON()` 写 localStorage）
    - `alive() -> boolean`：返回 false 时停止（不报错）
    - 请求失败直接 reject，已调用过的 `save` 保留进度

- [ ] **Step 1: 追加失败的测试**

```js
import { joinRanges, linkTracker, scanHistory } from '../links.js';

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

test('tracker: groups in order, label from the earliest text, restores from JSON', () => {
    const t = linkTracker();
    t.see(agent('https://a.com/z'), 3);
    t.see(user('[Spec](https://x.feishu.cn/docx/D1)'), 2);
    t.see(agent(MR), 1);
    assert.deepEqual(t.list().map((g) => g.kind), ['mr', 'doc', 'other']);
    assert.equal(t.list()[1].items[0].label, 'Spec');
    const back = linkTracker({ links: JSON.parse(JSON.stringify(t.toJSON())) });
    assert.deepEqual(back.list(), t.list());
    back.see(agent(MR), 1);
    assert.equal(back.list()[0].items[0].count, 1, 'a restored seq is not counted again');
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
        for (let s = Math.max(1, before - 3); s < before; s++) rows.push({ seq: s, view: agent(`https://a.com/${s}`) });
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && node --test test/links.test.mjs`
Expected: 新测试 FAIL（`joinRanges` 等未导出）

- [ ] **Step 3: 实现 `linkTracker` / `joinRanges` / `scanHistory`**

扫描算法（区间含义：区间内每条消息都已喂给 tracker；`before_seq = X` 的一页覆盖 `[rows[0].seq, X - 1]`，`hasMore` 为假时覆盖到 `0`）：

```
covered = { from: loaded.from, to: loaded.to }, complete = !loaded.hasOlder, cursor = loaded.from
if complete: covered.from = 0
loop:
  if cache and joinRanges(covered, cache): covered = 并集; complete ||= cache.complete; cursor = covered.from; cache = null
  if cache == null: save({ ...covered, complete })      // 只有和缓存连上后（或本来没缓存）才保存
  if complete or !alive(): return { complete }
  { rows, hasMore } = await fetchPage(cursor)
  rows.forEach(r => tracker.see(r.view, r.seq))
  covered.from = hasMore ? rows[0].seq : 0; complete = !hasMore; cursor = covered.from
```

（保存需去重：区间未变时不重复调用 `save`，上面「首页即无更早」测试期望恰好一次。）

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npm test`
Expected: 全部 PASS（含原有测试）

- [ ] **Step 5: 提交** — `feat(web): 链接去重和历史扫描`

---

### Task 3: 接线和右栏（宽屏常驻）

**Files:**
- Modify: `web/app.js`（import；`loadOlder` ~l.814、`renderMessage` ~l.1019、`openSession` ~l.709 末尾；新增「Links」小节，放在 `// ---------- Resume ----------` 之前）
- Modify: `web/index.html`（`main` 内 `#chat-head` 之后加 `<aside id="links" aria-label="链接" hidden></aside>`；CSS 放在 `#notice` 规则之后）

**Interfaces:**
- Consumes: Task 2 的 `linkTracker` / `scanHistory`；app.js 已有的 `api`、`decodePage`、`PAGE`、`state.collapsed`、`messageTime`（`time.js`）、`iconSvg`、`el`
- Produces（Task 4、5 使用）：
  - `trackLinks(thread, view, seq, live = false)`：喂 tracker；`live` 时把新 URL 记入 `thread.linksFresh`（Set）；当前会话时调用 `renderLinks()`
  - `renderLinks()`：按 `state.current` 的 `thread.links` 重画 `#links`；行的第二行是 `button.link-src[data-seq]`
  - `startLinkScan(s, thread)`：读缓存、调 `scanHistory`、写缓存、维护 `thread.linkScan: 'running' | 'done' | 'failed'`
  - `saveLinks(thread)`：把 `{ v: 1, ...thread.linkCover, links: thread.links.toJSON() }` 写入 `happy.links.<id>`

- [ ] **Step 1: 接线**
  - `thread` 创建时：读 `happy.links.<id>`（`v !== 1` 或 JSON 坏了当没有），`thread.links = linkTracker(cached)`，`thread.linkCache = cached ? { from, to, complete } : null`
  - `loadOlder` 循环、`renderMessage` 中，紧挨 `trackContext(...)` 调 `trackLinks`（`renderMessage` 传 `live = true`）
  - `renderMessage` 里，只要 `thread.linkCover` 已存在（扫描的 `save` 回调设过它，说明覆盖区间已和缓存连上），就设 `thread.linkCover.to = Math.max(thread.linkCover.to, thread.afterSeq)` 并 `saveLinks`；`renderMessage` 收到的消息与已载入区间连续（轮询按 `after_seq` 拉），所以可以直接延伸
  - `openSession` 中首次 `loadOlder` 之后调 `startLinkScan(s, thread)`（不 await）；`thread.linkScan` 为 `'running'` 或 `'done'` 时不重复启动
  - `startLinkScan`：`fetchPage` 用 `api('GET', /v3/sessions/<id>/messages?before_seq=<b>&limit=PAGE)`，`rows` 反转为升序后 `decodePage` 得 `{ seq: m.seq, view }`；`save` 时 `thread.linkCover = cover; saveLinks(thread)`；每页后若是当前会话 `renderLinks()`；`alive` 恒真（切会话也扫完）；失败 `console.error` 并置 `'failed'`

- [ ] **Step 2: `renderLinks()` 和 CSS**
  - 无当前会话、或 `thread.links.size === 0` → `#links.hidden = true`
  - 结构：`h3`「链接 · N」+ 右上 × 按钮（Task 5 接功能，先渲染）；每组一个可折叠的组头（`button.links-group`，复用侧栏 `groupHead` 的视觉：chevron + 名称 + 数量）；折叠按 Global Constraints 的键，点击时改 `state.collapsed`、写 `happy.collapsed`、`renderLinks()`（不要调用会重画侧栏的 `toggleCollapsed`）
  - 行：`a.link-name[href][target=_blank][rel=noopener][title=<完整 URL>]`（名字 + ↗）；`button.link-src` 文本「你 · 11月8日 14:20 · 提到 3 次」（时间 `messageTime(at)`，`at` 缺失则省略）
  - `thread.linksFresh` 中的行加 `.flash`，渲染后清空该集合
  - 底部状态：`'running'` 且已有链接 →「正在查找更早的消息…」；`'failed'` →「更早的消息未扫完 · 」+ `button`「重试」（`thread.linkScan = null; startLinkScan(...)`）
  - CSS：`main { container-type: inline-size; }`；`#links` 默认 `display: none`；`@container (min-width: 1476px) { #links:not([hidden]) { display: block; position: absolute; top: 28px; right: 24px; width: 260px; max-height: calc(100% - 52px); overflow-y: auto; } }`；`body.desktop-mac #links { top: 44px; }`；字号 13–14px，颜色沿用 `--muted` / `--rule` / `--moss-tint`；`.flash` 复用已有 `@keyframes flash`
  - 设置页已由 `body.in-settings main > :not(#settings-page)` 隐藏，无需额外处理

- [ ] **Step 3: 验证**

Run: `cd web && npm test && node --check app.js`
Expected: 测试全过，语法检查无输出

手动（`npm start`，浏览器开 `localhost:8080`，窗口 ≥ 1800px 宽）：
- 打开一个早先贴过飞书文档和 MR 的长会话：右栏先出现最新一页里的链接，几秒内补全更早的；Network 里能看到连续的 `before_seq` 请求，停在会话开头
- 刷新后再打开同一会话：右栏立即出现，且 `before_seq` 请求只补空档
- 发一条带链接的消息：右栏新增一行并闪烁
- 窄于 1476px 时右栏消失（Task 5 再加入口）

- [ ] **Step 4: 提交** — `feat(web): 会话右栏汇总链接`

---

### Task 4: 跳回原文

**Files:**
- Modify: `web/app.js`（Links 小节；`revealRow` ~l.1342 旁）
- Modify: `web/index.html`（`.msg.flash` 动画规则，与 `.tool-row.flash` 并列）

**Interfaces:**
- Consumes: Task 3 的 `button.link-src[data-seq]`；已有 `loadOlder`、`setCollapsed`、`thread.turns`
- Produces: `revealSeq(thread, seq) -> Promise<void>`

- [ ] **Step 1: 实现 `revealSeq`**
  - 节点查找：`thread.el.querySelector('[data-seq="<seq>"]:not(.turn)')`
  - 找不到且 `thread.hasOlder`：该行的 `.link-src` 文本临时换成「正在载入…」，循环 `await loadOlder(s, thread)` 直到找到、`!thread.hasOlder`，或会话已切走（`state.current !== s` 则放弃）；结束后恢复文本
  - 找到后：若 `node.closest('.turn')` 是折叠的轮次，从 `thread.turns` 中找 `block.el === 该轮次` 的 block，`block.userToggled = true; setCollapsed(block, false)`；然后 `scrollIntoView({ block: 'center', behavior: 'smooth' })`，`.flash` 重启动画（同 `revealRow` 的 `void offsetWidth` 手法）
  - 窄屏浮层（Task 5）中点击来源后关闭浮层

- [ ] **Step 2: 验证**

Run: `cd web && node --check app.js`
Expected: 无输出

手动：
- 点很早一条链接的来源 → 显示「正在载入…」，随后加载更早的消息、滚到那条并闪烁；滚动位置不乱跳
- 来源是 agent 中间文字（在折叠的「已工作」里）→ 轮次自动展开
- 来源已在屏幕上 → 直接滚动高亮

- [ ] **Step 3: 提交** — `feat(web): 右栏链接可跳回原文`

---

### Task 5: 窄屏浮层、隐藏开关和 README

**Files:**
- Modify: `web/index.html`（`#chat-head` 中 `#archive` 前加 `<button id="links-toggle" class="quiet" hidden aria-label="链接" title="链接"></button>`；CSS）
- Modify: `web/app.js`（Links 小节；`renderHead` 末尾调 `renderLinks()`）
- Modify: `web/tools.js`（`ICONS` 加 `link: Link`，`lucide-static/dist/esm/icons/link.mjs`）
- Modify: `web/README.md`（「能做什么」加一条）

**Interfaces:**
- Consumes: Task 3 的 `renderLinks()`、`#links`
- Produces: 无（终端任务）

- [ ] **Step 1: 实现**
  - 常量 `LINKS_WIDE = 1476`；`linksDocked() = document.querySelector('main').clientWidth >= LINKS_WIDE && !body.classList.contains('links-hidden')`
  - 启动时 `body.classList.toggle('links-hidden', localStorage.getItem('happy.linksHidden') === '1')`
  - `renderLinks()` 同时维护 `#links-toggle`：有链接时显示，内容为 `iconSvg('link')` + 数量；CSS 在 `@container (min-width: 1476px)` 内且 body 未 `links-hidden` 时隐藏它
  - × 按钮：宽屏下设 `happy.linksHidden = '1'` + `body.links-hidden`；浮层中则只关浮层
  - 开关按钮：宽屏且隐藏中 → 删 `happy.linksHidden`、去掉 `links-hidden`；否则切换 `#links.open`
  - 浮层 CSS（容器查询之外，及宽屏 `links-hidden` 时）：`#links.open:not([hidden]) { display: block; position: absolute; top: 72px; right: 16px; width: min(320px, calc(100% - 32px)); max-height: 60vh; overflow-y: auto; z-index: 20; background: #fff; border: 1px solid var(--rule); border-radius: 8px; box-shadow: 0 6px 24px rgba(38,42,39,.12); }`（`desktop-mac` 下 top 加 16px）
  - 关闭浮层：`document` 上 `pointerdown` 落在 `#links` 和 `#links-toggle` 之外、`Escape`、点浮层里的链接名或来源、切换会话（`openSession` 中 `#links.classList.remove('open')`）
  - README「能做什么」加一条，概括：右栏汇总 MR/PR、飞书文档、其他链接（只看你和 agent 的文字）；打开会话时后台扫完全部历史，结果按会话缓存在本浏览器；点名字新标签页打开，点来源跳回原文；主区够宽常驻，可 × 关掉，窄屏从标题栏的链接按钮弹出

- [ ] **Step 2: 验证**

Run: `cd web && npm test && node --check app.js && node --check tools.js`
Expected: 全过、无输出

手动：
- 宽 → 窄拖动窗口：右栏消失、标题栏出现链接按钮；点开是浮层，点外面 / Esc / 点链接关闭
- 宽屏点 × → 右栏收起、出现按钮；刷新后仍收起；点按钮恢复常驻
- 手机宽度（≤ 760px）浮层不溢出屏幕
- Mac 应用（如方便）：右栏不挡顶部拖拽区

- [ ] **Step 3: 提交** — `feat(web): 窄屏从标题栏打开链接浮层，右栏可收起`

---

## 收尾

在 worktree 里 `git rebase main`，在主 checkout `git merge --ff-only smooth-beacon`。
