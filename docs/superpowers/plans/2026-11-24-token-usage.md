# Token 用量统计和热力图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「用量」页：累计 / 最近 30 天 / 最多的一天，加最近 53 周的每日 token 热力图，点某天看明细。

**Architecture:** 两个纯模块：`web/tokens.js` 从解密后的消息里读出每次回复的 usage、去重、按本地日期累加，并做每个会话的缓存序列化；
`web/heatmap.js` 把所有会话的按天数字汇总成总数和 53×7 的格子（分档、月份标签、数字格式）。`app.js` 复用 `lines.js` 的 `syncLines`
逐个会话同步历史，缓存到 `happy.usage.<id>`，在新的 `#usage-page` 上渲染。

**Tech Stack:** 原生 ES module，无构建；`node --test`；Lucide 图标（`lucide-static`）。

**Spec:** `docs/superpowers/specs/2026-11-24-token-usage-design.md`

## Global Constraints

- 总数 = 输入 + 输出 + 写缓存 + 读缓存，四项全算；热力图颜色按总数。
- 所有会话都算（含已归档、side chat、subagent）；Claude 和 Codex 都算。
- 按消息的 `createdAt`（server 时间，毫秒）的**本地**日期归到某天。
- 缓存键 `happy.usage.<会话 id>`，带 `v: 1`；读写都 `try/catch`，格式不对当没有缓存。
- 删除会话时**不**删 `happy.usage.<id>`（不要加进 `deleteSession.js` 的 `STORAGE_PREFIXES`）；退出登录时删。
- 热力图 53 列（周）× 7 行（周一在上、周日在下），最后一列含今天；4 档颜色 + 「没有」，分档用有用量那些天的四分位。
- 模块被 import 时不碰 `document` / `window` / `localStorage`；import 写相对路径；4 空格、单引号、分号；注释英文，界面中文。
- 不加新依赖。

## Review Focus

1. 同一次 Claude 回复拆成多条消息、每条都带同一份 usage：只算一次，跨页、跨两次同步也只算一次。
2. Codex 的 usage 在单独的 `service` 空文本信封里（没有 turn）：要计入，不能因为没有 turn 被丢掉。
3. 跨年 / 跨月 / 今天是周日或周一时，热力图最后一列正好含今天，今天之后的格子为空。
4. 某个会话已从 server 删除：它的缓存仍计入总数；退出登录后全部清零。
5. 用户只用过一两天：分档阈值不能除零或全部落在最深一档以外（只有一个非零值时它就是第 4 档）。

---

### Task 1: `tokens.js`：读 usage、去重、按天累加

**Files:**
- Create: `web/tokens.js`
- Modify: `web/lines.js`（`syncLines` 里 `feed` 改成 `stats.see(r.raw, r)`，并在 JSDoc 里说明 row 原样传给 `see`）
- Test: `web/test/tokens.test.mjs`

**Interfaces:**
- Produces:
  - `replyUsage(raw) -> { key: string, input: number, output: number, cacheWrite: number, cacheRead: number, time: number|null } | null`
  - `localDay(ms: number) -> 'YYYY-MM-DD'`（本地时区）
  - `tokenStats(cached) -> { see(raw, row): boolean, days: Record<string, [input, output, cacheWrite, cacheRead]>, toJSON(): object }`
    `row` 是 `{ seq, raw, createdAt }`；`cached` 是之前 `toJSON()` 的结果或 null。

识别规则（对照 `happy-wire/src/sessionProtocol.ts` 的 `sessionEnvelopeSchema.usage`、happy-cli 的
`claude/utils/sessionProtocolMapper.ts` `attachUsageToLastEnvelope`、`codex/utils/sessionProtocolMapper.ts` `token_count`）：
- session 协议：`raw.role === 'session'`，信封 `env = content.type === 'session' ? content.data : content`，`env.role === 'agent'` 且 `env.usage.input_tokens` 是有限数。**subagent 也算**（和 `context.js` 不同）。
  `key = ['s', env.turn ?? '', env.subagent ?? '', input, output, cacheWrite, cacheRead].join('|')`，`time = env.time`。
  理由：Claude Code 每个 content block 写一行 JSONL，同一 `message.id` 的 usage 完全相同（本机 40 个会话 3728 行 / 1821 个 id，重复的全部相同），而信封里没有 `message.id`。
- 旧格式：`raw.role === 'agent'`、`content.type === 'output'`、`data.type === 'assistant'`、`data.message.usage`，sidechain 也算。
  `key = 'm|' + data.message.id`（没有 id 时退回同上的数字拼接），`time = Date.parse(data.timestamp)` 或 null。
- 缺的项按 0；负数 / 非数按 0。

去重：内存里一个 `Set` 记本次见过的 key；另外持久化 `edge = { min: [seq, key], max: [seq, key] }`，即 seq 最小和最大的那条计入的 usage 的 key，
`tokenStats(cached)` 启动时把这两个 key 放进 Set（下一次同步往前或往后接页时，边界上的重复都能挡住）。
`toJSON()` 返回 `{ days, edge }`；`see` 用 `row.createdAt`，没有时用 `usage.time`，都没有就不计（返回 false）。

- [ ] **Step 1: 写失败的测试** `web/test/tokens.test.mjs`，构造真实形状的记录：

```js
const env = (usage, extra = {}) => ({ role: 'session', content: { type: 'session', data: { id: 'e', time: 1, role: 'agent', turn: 't1', ev: { t: 'text', text: 'hi' }, usage, ...extra } } });
const u = { input_tokens: 4, cache_creation_input_tokens: 2528, cache_read_input_tokens: 13594, output_tokens: 6 };
const at = new Date(2026, 10, 3, 23, 30).getTime(); // local 2026-11-03

test('replyUsage: session envelope, subagent included, Codex usage-only service envelope', () => {
    assert.deepEqual(pick(replyUsage(env(u))), { input: 4, output: 6, cacheWrite: 2528, cacheRead: 13594 });
    assert.ok(replyUsage(env(u, { subagent: 'ckabc' })));
    const codex = { role: 'session', content: { type: 'session', data: { id: 'c', time: 1, role: 'agent', ev: { t: 'service', text: '' }, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20 } } } };
    assert.deepEqual(pick(replyUsage(codex)), { input: 100, output: 20, cacheWrite: 0, cacheRead: 900 });
    assert.equal(replyUsage(env(undefined)), null);
    assert.equal(replyUsage({ role: 'user', content: { type: 'text', text: 'x' } }), null);
});
test('replyUsage: legacy Claude output keyed by message id', () => { /* role agent, content.type output, data.type assistant, message.id 'msg_1' -> key 'm|msg_1' */ });
test('localDay: local calendar date', () => { assert.equal(localDay(at), '2026-11-03'); });
test('tokenStats: the same reply split over several messages counts once', () => {
    const st = tokenStats(null);
    assert.equal(st.see(env(u), { seq: 1, createdAt: at }), true);
    assert.equal(st.see(env(u), { seq: 2, createdAt: at }), false);
    assert.equal(st.see(env({ ...u, cache_read_input_tokens: 20000 }), { seq: 3, createdAt: at }), true);
    assert.deepEqual(st.days['2026-11-03'], [8, 12, 5056, 33594]);
});
test('tokenStats: a duplicate on the edge of a cached run is not counted again', () => {
    const a = tokenStats(null); a.see(env(u), { seq: 10, createdAt: at });
    const b = tokenStats(JSON.parse(JSON.stringify(a.toJSON())));
    assert.equal(b.see(env(u), { seq: 11, createdAt: at }), false); // newer page
    assert.equal(b.see(env(u), { seq: 9, createdAt: at }), false);  // older page
    assert.deepEqual(b.days['2026-11-03'], [4, 6, 2528, 13594]);
});
test('tokenStats: bad cache starts empty', () => { assert.deepEqual(tokenStats({ days: 'x' }).days, {}); });
```

（`pick` 是测试里取四个数字字段的小函数。）

- [ ] **Step 2: 跑测试确认失败** — `cd web && node --test test/tokens.test.mjs`，预期 FAIL（模块不存在）。
- [ ] **Step 3: 实现 `web/tokens.js`**，文件开头注释写明对照的 happy-cli / happy-wire 文件和去重理由；改 `lines.js` 的 `feed`。
- [ ] **Step 4: 跑测试** — `cd web && npm test`，预期全部 PASS（`lines.test.mjs` 不受影响）。
- [ ] **Step 5: 提交** — `git add web/tokens.js web/lines.js web/test/tokens.test.mjs && git commit -m "feat(web): 从会话消息里统计每天的 token 用量"`

### Task 2: `heatmap.js`：汇总、分档、格子

**Files:**
- Create: `web/heatmap.js`
- Test: `web/test/heatmap.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `days` 形状 `Record<'YYYY-MM-DD', [input, output, cacheWrite, cacheRead]>`。
- Produces:
  - `summarize(entries, today: Date) -> { total, last30, best: { day, total } | null, byDay: Map<day, { total, parts: [4], agents: Record<agent, number> }> }`
    `entries: [{ agent: string, days }]`；`last30` = 今天和之前 29 天；`best` 取总数最大的一天（相同取较早的）。
  - `thresholds(totals: number[]) -> [q1, q2, q3]`：只看 >0 的值，按升序取 25% / 50% / 75% 位置（`sorted[Math.floor(p * (n - 1))]`）；没有非零值时 `[0, 0, 0]`。
  - `levelOf(total, [q1, q2, q3]) -> 0..4`：0 表示没有；`total <= q1` → 1，`<= q2` → 2，`<= q3` → 3，否则 4。只有一个非零值时它是 4：`n === 1` 时 thresholds 返回 `[0, 0, 0]`。
    （`n >= 2` 时最大值 > q3 才是 4 —— 若全部相等，全是 1，接受。）
  - `heatmapWeeks(byDay, today: Date, weeks = 53) -> [{ month: string|null, days: [{ day, total, level } | null] × 7 }]`：
    周一开头；最后一列是今天所在的周；今天之后为 null；`month` 是这一列里有某月 1 号时的 `'N月'`，否则 null（第一列始终给出它的月份）。
  - `formatTokens(n) -> string`：`< 1e4` 用千分位（`'8,240'`）；`< 1e6` 一位小数万（`'12.5 万'`，`.0` 去掉）；`< 1e8` 整数万带千分位（`'4,820 万'`）；否则一位小数亿（`'12.4 亿'`，`.0` 去掉）。

- [ ] **Step 1: 写失败的测试**，至少包括：
  - `summarize` 两个会话同一天相加、`agents` 按 agent 分开、`last30` 不含第 31 天前的那天、`best` 正确。
  - `thresholds([0, 5])` → `[0, 0, 0]`，`levelOf(5, …)` → 4；`thresholds([1,2,3,4,5,6,7,8])` → `[2, 4, 6]`，`levelOf(0, …)` → 0。
  - `heatmapWeeks`：`today = new Date(2026, 10, 24)`（周二）→ 长度 53，最后一列 `days[0].day === '2026-11-23'`、`days[1].day === '2026-11-24'`、`days[2] === null`；
    `today` 为周日 `new Date(2026, 10, 29)` 时最后一列 7 天全非 null；跨年 `new Date(2027, 0, 1)` 时最后一列含 `'2026-12-28'`；某列含 11 月 1 日 → `month === '11月'`。
  - `formatTokens`：`8240 → '8,240'`，`125000 → '12.5 万'`，`48200000 → '4,820 万'`，`1240000000 → '12.4 亿'`，`100000000 → '1 亿'`。
- [ ] **Step 2: 跑测试确认失败** — `cd web && node --test test/heatmap.test.mjs`。
- [ ] **Step 3: 实现 `web/heatmap.js`**（日期用本地时间的 `new Date(y, m, d)` 逐天加减，复用 `tokens.js` 的 `localDay`）。
- [ ] **Step 4: 跑测试** — `cd web && npm test`，全部 PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(web): 用量热力图的汇总和分档"`

### Task 3: 「用量」页接入、同步和文档

**Files:**
- Modify: `web/index.html`（侧栏按钮、`#usage-page` 结构、样式）
- Modify: `web/app.js`（同步队列、页面开关、渲染、退出登录清缓存）
- Modify: `web/tools.js`（`ICONS` 加 `usage`，用 Lucide 的 `chart-bar`：`./node_modules/lucide-static/dist/esm/icons/chart-bar.mjs`（已确认存在；看其他图标怎么 import 的照写））
- Modify: `web/README.md`（新增「用量」一节 + 「文件」一节加 `tokens.js`、`heatmap.js`）、`web/AGENTS.md`（localStorage 键加 `happy.usage.<会话 id>`；「扫历史的两套缓存」改成三套并写用量的去重规则和不随删除清理）

**Interfaces:**
- Consumes: `replyUsage`/`tokenStats`/`localDay`（Task 1），`summarize`/`thresholds`/`levelOf`/`heatmapWeeks`/`formatTokens`（Task 2），`syncLines`/`LATEST`（`lines.js`），`agentFlavor`/`AGENT_NAMES`（`agentIcons.js`）。

页面：
- 侧栏头部 `#settings-open` 前加 `<button id="usage-open" class="icon-btn" aria-label="用量" title="用量">`。
- `#settings-page` 旁边加 `<section class="column" id="usage-page" aria-labelledby="usage-title">`：头部和设置页一样（返回按钮 `#usage-back` + `<h2>用量</h2>` + 进度 `#usage-progress`）；
  三个数 `#usage-stats`（累计 / 最近 30 天 / 最多的一天（MM-DD））；`#usage-heatmap`（`overflow-x: auto`，渲染后 `scrollLeft = scrollWidth`）；图例「少 □□□□ 多」；明细 `#usage-day`；
  一行 hint：「按每次回复的时间统计 Happy 里所有会话的 token（输入、输出、写缓存、读缓存都算），只保存在这个浏览器里；终端里直接用的不算。」
- 格子是 `<button>`，`data-level` 0–4，颜色 `color-mix(in srgb, var(--moss) X%, var(--rule))`，X 依次 0/30/55/80/100（实现者可微调，保持亮暗都能分清）；`title` 为「11 月 3 日 周一 · 4,820 万」。
  悬停和点击都更新 `#usage-day`：日期星期、总数、「读缓存 · 写缓存 · 输入 · 输出」、各 agent（`AGENT_NAMES`）。默认显示今天。
- 状态类 `in-usage`：`openUsage()` 加 `in-usage` + `in-chat` 并去掉 `in-settings`；`openSettings()` 去掉 `in-usage`；`openSession` 那处 `remove('in-settings')`（app.js:1328）同时去掉 `in-usage`。
  加 `const coveredByPage = () => body 有 in-settings 或 in-usage`，替换 app.js 里表示「聊天被页面盖住」的判断：487、1293、3325、3466、3814、4180 行；只用于 `renderSettings()` 的判断不动。
  `index.html` 里每条含 `in-settings` / `#settings-page` / `#settings-open` 的规则都补上对应的 `in-usage` / `#usage-page` / `#usage-open`（`grep -n in-settings web/index.html` 逐条处理，包括 `body.desktop-mac` 的）。

同步（照 `lines` 那一套写一份精简版，放在 `// ---------- Token usage ----------` 段）：
- `state.usage: Map<id, { stats, cover, agent, busy, failedAt }>`、`state.usageQueue`、`state.usageRunning`、`state.usageGen`、`state.usageRender`。
- `usageOf(s)` 读 `happy.usage.<id>`：`{ v: 1, agent, from, to, complete, ...stats.toJSON() }`；`saveUsage` 写回。`agent = agentFlavor(s.meta)`。
- `queueAllUsage()`：页面打开时调用，`state.sessions` 里每个 `!cover || !complete || cover.to < s.seq` 的会话入队（失败一分钟内不重试）。
- `runUsage()` 一次一个会话，`syncLines({ stats, cover, target: () => s.seq ?? 0, fetchOlder, fetchNewer, save, alive })`，页大小 500，
  row 带 `createdAt: m.createdAt`（`linesRows` 抽成接受这个字段，或单独写 `usageRows`）。
- 页面开着时：`syncSessions` 末尾和收到推送消息（app.js:3155 附近 `pushLines` 那里）各调一次 `queueAllUsage()` / 让该会话入队。页面关着不同步。
- 渲染节流 250ms（同 `linesChanged`）。汇总的数据来源是 `localStorage` 里**所有** `happy.usage.*`（包括已不在 `state.sessions` 的已删会话），内存里有的用内存的。
- 进度：队列里还有会话时显示「统计中 已完成 / 会话总数 个会话…」，完成后显示「已统计 N 个会话」。
- `logout()`：按前缀删除的那一行加 `happy.usage.`；`state.usageGen++`，重置 `usage` 相关状态。

- [ ] **Step 1: 实现上面的改动**；`cd web && node --check app.js && npm test`，预期通过。
- [ ] **Step 2: 打包检查** — `cd desktop && npm run check`（`node build.mjs --check`），预期无缺文件，`tokens.js`、`heatmap.js`、`chart-bar.mjs` 都在。
- [ ] **Step 3: 浏览器里看** — `cd web && npm start`，用 Playwright 打开 http://localhost:8080，没有真实账号时在控制台把几个构造的 `happy.usage.<id>` 写进 localStorage 并直接调用渲染来截图：桌面宽度和 390px 宽各一张，确认最后一列在右侧可见、颜色分得清、点格子明细会变。截图放 `/tmp/claude-0/apk/` 并说明未在真实账号下验证（如属实）。
- [ ] **Step 4: 更新 `web/README.md`、`web/AGENTS.md`**（见 Files）。
- [ ] **Step 5: 提交** — `git commit -m "feat(web): 新增用量页，显示 token 总数和每日热力图"`

### 收尾

- [ ] `git fetch origin && git rebase origin/main`，重跑 `npm test`；到主 checkout `git merge --ff-only swift-island`，`git push origin main`；删除 worktree 和分支（按仓库 AGENTS.md）。
