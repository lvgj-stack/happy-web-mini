# 会话右栏：链接汇总 设计

日期：2026-11-09 · 范围：`web/`（Mac 应用共用同一套代码）

## 背景与目标

长会话里，自己贴过的需求 Spec 链接、agent 创建的 MR 链接很快被淹没，每次都要向上翻找。
会话页右侧（聊天栏居中 860px 之外）在宽屏下一直空着。

目标：把会话里出现过的关键链接**自动**收集到右栏，点一下直接打开，也能跳回出现它的原文。

成功标准：
- 打开任意会话（包括很早以前发过 MR 的长会话），右栏能列出其中所有 MR/PR 和飞书文档链接，不需要先向上滚动
- 点链接在新标签页打开；点来源能跳到原文（即使原文还没载入）
- 不影响现有的载入速度和聊天栏布局

不做（YAGNI）：手动 pin、改动文件列表、任务进度、计划、会话状态卡片；抓取网页标题；工具输入/输出里的 URL。

## 1. 分组和显示

只从**用户消息**和 **agent 文字回复**（含一轮中间的文字）里取链接；工具调用的输入和输出一律不看。
用 marked 的词法分析提取 `[文字](url)` 和被 GFM 自动识别的裸 URL，跳过代码块和行内代码。只收 http(s)。

分组（按此顺序，空组不显示）：

| 分组 | 识别规则 | 显示名 |
|---|---|---|
| MR / PR | 路径含 `/merge_requests/<n>`（Codebase、GitLab，含 `/-/merge_requests/<n>`）；`github.com/<o>/<r>/pull/<n>` | `仓库名 !<n>`；GitHub 为 `仓库名 #<n>` |
| 飞书文档 | 主机为 `feishu.cn`、`larkoffice.com`、`larksuite.com`、`feishu-boe.cn` 或其子域，路径首段为 `docx` `docs` `wiki` `sheets` `base` `mindnotes` `slides` | 有链接文字用链接文字；否则「文档 / Wiki / 表格 / 多维表格 / 思维笔记 / 幻灯片」+ token 前 6 位 |
| 其他链接 | 其余 URL | 有链接文字用链接文字；否则 `域名 + 路径`，过长截断 |

MR/PR 的显示名以 URL 解析出的编号为准，不用链接文字（链接文字常是「这里」「MR」之类）。
「链接文字」指 Markdown 链接里与 URL 本身不同的文字；裸 URL 没有链接文字。

每行：

```
[图标] fe_mono !1234                 ↗
       你 · 11-08 14:20 · 提到 3 次
```

- 第一行（名字 / ↗）：新标签页打开（`target="_blank" rel="noopener"`）；悬停显示完整 URL
- 第二行：来源（「你」/「agent」）、最早出现的时间、出现次数（1 次时不显示）；点击跳回原文
- 同一 URL 只出现一行，取最早出现的那次。去重前对 URL 做规范化：去掉末尾的 `/` 和 `#` 片段

## 2. 数据流、缓存和跳转

### `web/links.js`（纯函数，可在 node 中测试）

- `extractLinks(markdown) -> [{ url, text }]`：文字 → 链接
- `classifyLink(url, text) -> { kind: 'mr' | 'doc' | 'other', label }`
- `linkTracker(cached?)`：
  - `see(view, seq)`：喂入一条解码后的消息（任意顺序）。只处理用户消息和 agent 文字；同一 `seq` 重复喂入不重复计数
  - `list()`：按分组返回 `{ kind, items: [{ url, label, who, at, seq, count }] }`，组内按最早出现的 seq 升序
  - `toJSON()` / 从 `cached` 恢复：用于持久化
- 每个 URL 记：最早出现的 `{ seq, who, at }`、出现过的 seq 集合、最早那次的链接文字

### 三个入口，喂同一个 tracker（挂在 `thread.links` 上）

1. `loadOlder`：与 `trackBackground` / `trackContext` 同处
2. `renderMessage`：实时推送和轮询到的新消息
3. 后台扫描 `scanLinks(s, thread)`：打开会话、拉完最新一页后启动
   - 用自己的游标向前分页（`before_seq`，每页 `PAGE` 条），不动 `thread.oldestSeq`，不影响上滚加载
   - 只解密和提取，不渲染
   - 跳过缓存已覆盖的区间；到达会话开头（`hasMore: false`）即完成
   - 切到别的会话也继续扫完；每个会话同一时间最多一个扫描（`thread.scanning`）

### 缓存：`localStorage['happy.links.<会话 id>']`

```json
{ "v": 1, "from": 1, "to": 5321, "complete": true, "links": { "<url>": { "seq": 12, "who": "user", "at": 1731100000000, "text": "需求 Spec", "seqs": [12, 880] } } }
```

- `[from, to]`：已连续扫描覆盖的 seq 区间；`complete` 表示 `from` 已是会话开头
- 打开会话时先用缓存画出右栏；扫描只需补「`to` 到当前已加载最老 seq」之间的空档，以及 `complete` 为假时 `from` 之前的部分
- 每扫完一页、每收到新消息都更新区间并写回（只在区间连续时扩展），刷新页面后可接着扫
- 每个会话的数据很小，不做清理

### 跳回原文

- 原文已渲染（`thread.el` 中有该 `data-seq` 的节点）：若它在折叠的「已工作」轮次里，先展开该轮次；然后 `scrollIntoView({ block: 'center', behavior: 'smooth' })` 并闪烁高亮，复用 `revealRow` 的做法
- 未渲染：该行显示「正在载入…」，循环 `loadOlder` 直到 `thread.oldestSeq <= seq`（或没有更早的消息），再执行上一步

### 出错

- 扫描某页请求失败：停止扫描，右栏显示已有结果，底部灰字「更早的消息未扫完 · 重试」（点「重试」重启扫描）；下次打开该会话也会自动重试
- 单条消息解密失败：跳过

## 3. 布局和交互

- 位置：主区右边距，顶部与会话标题对齐；宽 260px，离右边缘 24px；最高到输入框上沿，超出时右栏内部滚动
- 聊天栏保持居中，右栏开合不引起正文移动
- 断点（CSS 容器查询，按主区宽度）：
  - 宽（右边距 ≥ 260 + 2×24px）：右栏常驻；标题「链接 · N」，右上角 × 关闭
  - 窄（含手机）：不显示右栏；标题栏「归档」左边出现链接图标 + 数量，点开在图标下方弹出浮层（内容同右栏）；点外部、Esc 或点浮层里的链接后关闭
  - 宽屏下用 × 关闭后同样显示该图标，点击重新打开。关闭状态全局记在 `localStorage['happy.linksHidden']`
- 没有任何链接时：右栏和图标都不出现；扫描中且尚无结果时也不出现（不闪）。已有链接且扫描未完成时，底部灰字「正在查找更早的消息…」
- 分组折叠：MR/PR、飞书文档默认展开，「其他链接」默认折叠。复用 `state.collapsed`（`happy.collapsed`）：`links:mr`、`links:doc` 在集合中表示折叠；「其他链接」相反，`links:other` 在集合中表示**展开**
- 新链接到达：实时追加一行并闪烁一次，不弹通知
- Mac 应用：右栏位于顶部拖拽区下方，不加 `-webkit-app-region: drag`

## 测试

- `web/test/links.test.mjs`（`npm test`）：
  - 提取：Markdown 链接文字、裸 URL、代码块和行内代码中的 URL 不收、非 http(s) 不收
  - 分类：Codebase / GitLab（含 `/-/`）MR、GitHub PR、各飞书域名和路径类型、其他
  - tracker：乱序喂入保留最早那次、同一 seq 不重复计数、URL 规范化去重、`toJSON` 后恢复结果一致
- 浏览器手动验证：一个长会话首次打开的后台扫描、刷新后从缓存恢复、跳回很早的原文、宽窄断点切换和浮层、Mac 应用拖拽区
- README「能做什么」补一条说明
