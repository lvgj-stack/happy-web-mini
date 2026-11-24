# web/AGENTS.md

网页客户端的开发规范和实现要点。仓库级的规范（worktree、提交、发版）见 [../AGENTS.md](../AGENTS.md)，
功能说明见 [README.md](README.md)。

## 结构

- 没有构建步骤：浏览器直接加载 `index.html`，`app.js` 作为 ES module 引入其余模块。没有打包器，也没有 TypeScript。
- `index.html`：页面结构和**全部样式**（一个 `<style>`），外加两个全局脚本（`tweetnacl`、`qrcode-generator`）。
- `app.js`：状态（`state`）、DOM、网络、实时推送，所有东西在这里接起来。
- 其余每个 `.js` 是一块独立的逻辑（模型列表、链接提取、改动行数、审批卡片的文案……），尽量写成纯函数，由 `app.js` 调用。
  文件的作用见 README 的「文件」一节。
- `test/<模块>.test.mjs`：`node --test` 跑的单测，一个模块一个文件。

## 写代码

- **import 一律写相对路径**：自己的模块写 `./links.js`，第三方包写到具体文件，例如
  `./node_modules/marked/lib/marked.esm.js`、`./node_modules/lucide-static/dist/esm/icons/link.mjs`。浏览器不认裸模块名。
- **新文件要能被 Mac 打包找到**：`desktop/build.mjs` 从 `index.html` 出发，用正则顺着 `<script src>` / `<link href>` 和
  `from './…'` / `import('./…')` 找出页面需要的文件，只复制这些。动态拼出来的路径找不到，`npm run check` 和打包会漏文件。
- **逻辑放进独立模块，并且能在 Node 里测**：模块被 import 时不要碰 `document`、`window`、`localStorage`。
  需要网络或存储的地方，把函数当参数传进去（参考 `links.js` 的 `scanHistory`、`lines.js` 的 `syncLines`）。
  `app.js` 只负责把它们接到 DOM 和接口上。
- 风格：4 个空格缩进，单引号，带分号，`const` 优先，函数前面用一行 `/** … */` 说清楚它返回什么。
  注释用英文，解释"为什么"；界面上的文字用中文。
- 对照官方 App 或 CLI 实现的，在文件开头或函数注释里写明对照的是哪个（例如「对照 iOS 的 AgentCommunications」）。
- 图标用 Lucide：在 `tools.js` 里按需 import 单个图标，加进 `ICONS`，用 `iconSvg(name)` 取。Agent 的 logo 在 `agentIcons.js`。
- 不加新依赖，除非真的必要。确实要加时，`npm install` 后检查打包能不能找到它的文件。

## 状态和本地存储

- `localStorage` 的键都以 `happy.` 开头。现有的键有：`happy.server`、`happy.token`、`happy.secret`、`happy.seen`、
  `happy.collapsed`、`happy.hostOrder`（电脑的顺序，`{ v: 1, keys: [machineKey…] }`）、`happy.archivedOpen`、`happy.bgDismissed`、`happy.brand`、`happy.sideWidth`、`happy.sideCollapsed`、
  `happy.linksHidden`、`happy.linkNames`（右栏链接自定义名称，`{ v: 1, names: { url: label } }`，退出登录时清除）、`happy.links.<会话 id>`、`happy.lines.<会话 id>`、`happy.usage.<会话 id>`（用量页的 token 统计），以及各模块自己的设置：`happy.defaults`（默认模型 / 强度 / 权限）、
  `happy.wallpaper` / `happy.wallpaper.image`（背景）、`happy.chatScale`（字号）、`happy.notify` / `happy.notifySound`（通知）、
  `happy.newWorktree`（新建会话默认新建 worktree，值 `new`；没有就是直接在目录里，见 `worktree.js`）。
- 已读：正在看的会话，标签页可见、不在设置页或用量页（`coveredByPage()`）、并且窗口有焦点（`document.hasFocus()`）才算看过（`viewing()`），网页和 Mac 应用一样；
  窗口重新拿到焦点（`focus`）时补标已读。
- **从会话里解密出来的内容**（链接、文件路径之类）按会话缓存时，退出登录要清掉：加到 `logout()` 里按前缀删除的那一行。
- 读缓存要容错：用 `try/catch` 包住 `JSON.parse`，带上版本号 `v`，格式不对就当作没有缓存，重新算。
  写缓存也包 `try/catch`（配额可能满了，背景图本身就占 1.5 MB 左右）。
- 只存在本浏览器里的设置，在 README 里写明「只保存在这个浏览器里」。
- 侧栏拖动电脑排序用 HTML5 拖放（`dragHost`）。拖动期间 `renderList` 不重建列表（重建会删掉正被拖的标题，拖动就断了），
  松手后再补一次。顺序按 `machineKey` 存，离线的电脑留在存储里不删，上线后回到原位（`hostOrder.js` 的 `moveHost`）。

## 协议要点

和 server、CLI 打交道时容易踩的地方。改到这些逻辑时以 Happy 仓库的代码为准，并更新这里。

### 账户、加密、接口

- 默认服务器 `https://api.cluster-fluster.com`，可以换（`happy.server`）。账户主密钥存在 `localStorage`。
- 会话的数据密钥用账户密钥解包；消息、metadata、agentState 都是 AES-256-GCM（`crypto.js`）。旧版 secretbox 会话不支持。
- 会话列表：`GET /v2/sessions`，之后每 30 秒带 `changedSince` 增量拉取。
  「在线」= `active` 且 15 分钟内有活动（`ONLINE_WINDOW`，和 `GET /v2/sessions/active` 一致），未归档，不是侧聊（`isSideChat`）。
- 消息：`GET /v3/sessions/:id/messages`。`after_seq=N` 按 seq 升序给 N 之后的，`before_seq=N` 按 seq 降序给 N 之前的，
  两者互斥，`limit` 最大 500，都带 `hasMore`。`before_seq=2147483647`（`LATEST`）就是最新一页。
  每个会话的 seq 从 1 开始连续分配，只有消息会占用 seq；会话对象上的 `seq` 就是最新一条消息的 seq。
- 发消息：`POST /v3/sessions/:id/messages`，加密后放进 `messages`；模型、强度、权限模式放在 `meta.model` / `meta.effort` /
  `meta.permissionMode`（Happy Agent 会话再带 `modelProviderId`）。Codex 选「跟随 Codex 配置」时发 `model: null`
  （没选强度时再加 `effort: null`），CLI 就不用它内置的默认值，改按那台电脑的 `~/.codex/config.toml`。
- 实时推送走 Socket.IO：`new-message`、`update-session`、`new-session`、`delete-session`，以及临时事件 `activity`（含 `thinking`）和
  `machine-activity`。断线时退回每 3 秒轮询正在看的会话，重连后补拉。
- 删除已归档会话（`deleteSession.js`）：调用 `DELETE /v1/sessions/:id`（404 视为已删，对照 iOS `SessionActions.deliver`）；
  只对已归档的普通会话开放，Bot / 任务不提供删除（对照 iOS `SessionInfoModel.keepsConversation`、Android `SessionOps.delete`）。
  本标签页发起删除时把会话 id 放进 `state.deletingIds`，忽略服务端回推的 `delete-session` 避免和本地收尾冲突；
  删除后清理内存状态和该会话在 `localStorage` 里的键（`happy.links.*` / `happy.lines.*` / `happy.model.*` / `happy.effort.*` / `happy.permission.*` / `seen` / `bgDismissed`）。
  `happy.usage.*` 故意不删：删掉的会话继续计入用量，只在退出登录时清掉。
  残留 worktree 的检查按 `(machineId, repo)` 分组调用一次 `listWorktrees`，避免批量删除时重复发 RPC，且只删没有被其余未删会话继续引用的 worktree。

### 消息格式

- 新格式是 session protocol：`role: 'session'`，事件在 `content.data.ev`（或直接在 `content.ev`）里，
  `t` 有 `text`、`service`、`tool-call-start`、`tool-call-end`、`turn-start`、`turn-end`、`file`……
  `tool-call-start` 带 `call`、`name`、`title`、`args`；subagent 的事件带 `subagent`。
- 旧格式：Claude 的 `role: 'agent', content.type: 'output'`（`tool_use` 块），CLI 的状态事件 `content.type: 'event'`。
- 工具名：Claude 的（`Bash`、`Edit`、`Write`……），Codex 的（`CodexBash`、`CodexPatch`、`apply_patch`……），
  ACP（Cursor 等）的工具种类（`read`、`edit`、`delete`、`move`、`execute`……）。
  `CodexDiff` / `GeminiDiff` 是 CLI 每轮反复发送的累计 diff，**不是**一次修改。
- `/clear` 只回一条「Context was reset」事件；服务器上的历史消息不会删。
- 一个 turn 的 seq 区间里可以夹着用户消息：CLI 在 turn 结束（Claude 的 `result`）前不会把新消息交给 agent，turn id 不变，
  后面的步骤照常带着原来的 turn。所以折叠块不能一个 turn 一个：`turns.js` 把用户发的消息（文字、自己发的图）的 seq 记成 break，
  同一个 turn 的步骤只有和已有的块之间没有 break 才并进去，否则在消息后面新开一块（`thread.turns` 是 turn id → 块的数组）。
  整页的 break 要在放这一页的步骤之前先记下（`noteBreaks`），往上翻历史时旧页里的消息才能把已经在屏幕上的块隔开。
  `tool-call-end` / `turn-end` 不单独开块，并到前面最近的块；同一个 turn 的块共用 `tools` / `endedCalls`，工具可以在下一块里结束。
  还在跑的块后面有了用户消息就不再算「正在工作」（`isCut`），底部改显示「正在思考」，下一步到了在消息下面开新块。
- 子 agent（`subagents.js`，对照 happy-cli `claude/utils/sessionProtocolMapper.ts`、happy-android `chat/ReducerTracer.kt`）：
  子 agent 产生的每个信封都带 `subagent`（CLI 由启动它的 tool call id 算出的 cuid），开头一条 `start { title }`、结尾一条 `stop`；
  前台跑的第一条 text 是交给它的 prompt，后台跑的没有这条，所以面板顶上的「任务」取启动参数的 `prompt`。启动它的 `Agent` 调用在 `args.sessionSubagent` 里带同一个 id（Codex 的 `CodexSubagent` 还可能在
  `sessionSubagents` 里列几个）。`toView` 给所有 session 信封的 view 带上 `subagent`，`placeView` 一见到就交给 `placeSubagentStep`，
  不进 turn 块，所以子 agent 的文字不会被当成这一轮的最终回答。启动行（`bindSubagent`）显示步数、点开 `#subagent` 面板；
  一轮折叠后它启动的子 agent 行仍然露在外面（CSS 只藏 `.turn-body` 里别的东西，对照 Android 的回合卡片）。
  旧的 `Task` 工具调用被 CLI 藏掉了，没有启动行：子 agent 做了事（有工具或文字）后补一行（`stand: true`），往上翻历史翻到真正的启动行时删掉补的那行。
  后台跑的子 agent 启动调用立刻结束，CLI 在一轮结束时还会给它发 `stop`，所以是否还在跑看 `background.js`（行上的 `sub-running`）。
  CLI 只在远程模式（SDK 带 `parent_tool_use_id`）转发子 agent 的步骤。一轮结束时 CLI 清掉子 agent 的映射（`closeTurn` →
  `clearSubagentTracking`），之后后台子 agent 的步骤都被缓存起来不再发出，面板里只能看到这一轮结束前的部分。
  CLI 偶尔会把主 agent 的步骤错标成子 agent 的（按 parentUuid 继承），这种步骤只出现在面板里。

### RPC

- 会话 RPC（经 socket）：`permission`（批准 / 拒绝工具调用，回答 AskUserQuestion 时带 `updatedInput.answers`；
  Codex 有 `approved_for_session`）、`communication`（Codex / Happy Agent 的提问表单）、`abort`、`bash`、`killSession`（归档）。
- 机器 RPC：`spawn-happy-session`（新建会话）、`resume-happy-session`（恢复会话，带上会话密钥作为 fallback）、
  `bash`（worktree 的列出 / 新建 / 删除 / 重建，见 `worktree.js`）、`claude-fork-session` / `codex-fork-thread`（fork）。
- daemon 的 RPC handler 抛错时，回的是 `{ error: "..." }`，不是 `{ type: 'error' }`（happy-cli `RpcHandlerManager.handleRequest`）。
  恢复会话目录不在时就是这样（`resumeSessionAttempt` 里 `fs.access(cwd)` 抛 ENOENT），`resumeFailure` 两种都认，对照 iOS `MachineActions.machineResumeSession`。
  fork 的两个 RPC 和 spawn 同理，结果里先看 `error`。
- 恢复失败最常见的原因是归档时删了 worktree。`resumeDirectoryGone` 认出目录不在、路径又在 `.dev/worktree/<名字>` 里时，
  网页用 `restoreWorktree` 在原路径重建（`git worktree prune` 后检出同名分支，分支没了就从主 checkout 新建）再重试一次。
  Claude 的 JSONL 按路径存在 `~/.claude/projects/` 下，和 worktree 目录无关，所以同一路径能接上。
  daemon 重启后旧 CLI 进程还在时会拒绝恢复（"may still have a running process from a previous daemon"），网页只翻译提示，不绕过。
- Fork（对照 iOS `MachineActions.forkAndSpawn`）：先用 `claude-fork-session { directory, claudeSessionId }` 或
  `codex-fork-thread { directory, codexThreadId }` 让 daemon 复制对话，拿到 `newClaudeSessionId` / `newCodexThreadId`；
  再 `spawn-happy-session` 带 `resumeClaudeSessionId` / `resumeCodexThreadId` 和 `parentSessionId` 新建会话，
  CLI 会把复制来的历史回放进新会话。spawn 回 `requestToApproveDirectoryCreation`（目录没了）时同样先重建 worktree，不新建空目录。
- 新建会话的 Worktree 选中哪项（`worktreeSelection`）：本次对话框里手动选过且还能选的 → 目录本身就是某个 worktree 时选它 →
  设置里的默认值。手动选择在打开对话框、换电脑、启动成功后清掉，改目录不清（打字过程中不会被重置）。
  选「新建 worktree」时可指定名字（`worktreeNameError` 校验单层目录 + git 分支名，留空自动随机）；指定名字已存在时直接报错，不自动加 `-2`。
- Codex 的模型列表经会话的 `bash` RPC 在那台电脑上查 `codex app-server`（`codexModels.js`），不用升级 Happy CLI。
- CLI 不在线时归档：网页自己用 `update-metadata` 写 `lifecycleState: "archived"`。

### 附件

- 图片用会话密钥派生的 `Happy Blobs` 密钥（secretbox）加密，经 `POST /v1/sessions/:id/attachments/request-upload` 拿到地址再上传，先发 file 事件再发文字。
  只发图片时自动补一句文字，因为 CLI 总会附一段文字，Claude 不接受空文字。
- 自托管服务器可能返回 `http://<它自己>/…` 的上传 / 下载地址，和服务器同主机的按服务器的 https 改写（`serverUrl.js`），
  否则 https 页面和 Mac 应用会当混合内容拦掉。

### 只能推断的状态

- 后台任务（`background.js`）：Agent 调用写了 `run_in_background: true` 的算后台；什么都没写的（Claude Code 现在默认放后台），
  看顺序：调用 5 秒内就结束、它的子 agent 在结束之后才出现，就是后台跑的；子 agent 在调用结束前就干活的是前台，
  没有子 agent 出现的（立刻报错，或者本地模式不转发）不算，免得一直显示在跑。CLI 不转发后台任务的中间过程，还会丢掉 SDK 的任务结束消息，所以只能靠
  `<task-notification>` 判断结束，判断不了的让用户手动清除（`happy.bgDismissed`）。
  子 agent 自己在后台启动的命令，通知只发给那个子 agent，不要算进来，否则会一直显示在跑。
- 上下文剩余（`context.js`）：按最近一条回复的 `usage`（input + cache_creation + cache_read，subagent 的不算）和 CLI 盖上的 `context_window` 算。
- 订阅用量（`usage.js`）：来自 `agentState.usageLimits`，只有 Claude 会话上报。

### 文件路径链接

- agent 常用文件路径当链接目标。`markdown.js` 在 DOMPurify 的钩子里用 `links.js` 的 `localPath()` 认出这类链接（没有 scheme 的相对 / 绝对路径、`file:`），
  去掉 href，改成 `.path-link` + `data-path`；`app.js` 里点击或回车就复制路径。`#L12` 转成 `:12`。

### 扫历史的三套缓存

- 右栏链接（`links.js`）：打开会话后扫一遍历史，缓存在 `happy.links.<id>`，记录已覆盖的 seq 区间，下次只补新的。
- 改动行数（`lines.js`）：后台一次一个会话地同步所有在线会话加上正在看的那个（`wantLines` / `runLines`）。
  先用 `after_seq` 补新消息，再用 `before_seq` 往前扫到头；有刚打开的会话在排队时，往前扫的会话每翻一页就让一次。
  推送来的消息 seq 正好接上就直接累加，接不上就排队同步。失败后一分钟内不重试。缓存在 `happy.lines.<id>`。
- Token 用量（`tokens.js` 读 usage、`heatmap.js` 汇总和分档，`app.js` 的 `// ---------- Token usage` 段）：只在用量页开着时同步
  （`in-usage`；页面关掉后当前这一页拉完就停），`state.sessions` 里所有会话（含已归档、侧聊）一次一个，同样走 `syncLines`，每页 500 条，
  最近活跃的先同步；`syncSessions` 结束和收到推送时补新消息，推送不直接累加。失败后一分钟内不重试。缓存在 `happy.usage.<id>`：
  `{ v: 1, agent, from, to, complete, days, edge, checkedTo?, replayEnd?, replayScan? }`，`days` 是本地日期 → `[输入, 输出, 写缓存, 读缓存]`，`agent` 是 `agentFlavor(meta)`。
  后三个是后加的可选字段，没有就按 0 / 未知处理，旧缓存照样能读。每次同步完把 `u.stats` 用 `toJSON()` 重建一遍，
  丢掉本次见过的键（只留 edge），不然重度用户开着页面不刷新时这个 Set 会一直长。
  - `checkedTo`：server 先分配 seq 再拒掉重复的 `localId`，所以会话的 `seq` 可能比最后一条消息大，永远等不到。
    往后翻到空页或 `hasMore: false`（或者拿到最新一页）时，把发请求那一刻的 `s.seq` 记成 `checkedTo`，
    `usageDone` 用 `max(to, checkedTo)` 比，免得这个会话每 30 秒重拉一次、进度一直说「没统计完」。`lines.js` 的语义不变。
  - Fork 的回放（`replayEnd` / `replayScan`）：happy-cli `claude/runClaude.ts` 的 fork backfill（`HAPPY_FORK_CLAUDE_SESSION_ID`，
    非侧聊）把父会话整个 JSONL 经 protocol mapper 重发进新会话，每条 assistant 行都带着原来的 `usage`，turn id 是新的，
    信封时间是 fork 那一刻，不处理的话父会话的全部用量会在 fork 那天再算一遍。回放一定在 CLI 接收第一条消息之前，
    回放出来的用户消息是 `role: 'session'` 信封，从 App 发的是原始的 `role: 'user'` 记录。所以 `replaysHistory(meta)`
    （有 `parentSessionId`、不是侧聊）的会话，同步前先用 `after_seq` 从头往后翻（每页 500），找第一条 `role === 'user'`
    （`tokens.js` 的 `replayEnd`），存进 `replayEnd`；seq 比它小的不计，cover 直接从 `replayEnd - 1` 开始，回放不再拉第二遍。
    还没有 App 发的消息时整个会话不计，`replayScan` 记下翻到哪了，下次从那接着翻。
    Codex 的 fork backfill（`codex/runCodex.ts`，`HAPPY_FORK_CODEX_THREAD_ID`）不带 usage，同样处理也无妨。
    只在终端里（本地模式）往 fork 会话里打字的，没有原始 `role: 'user'` 记录，整个会话都不计。
  - 哪些算：session 协议里 `role: 'agent'` 且带 `usage` 的信封（subagent 的也算；Codex 的 usage 单独放在一个空文本的 `service` 信封里，没有 turn），
    旧格式 Claude `output` 里 `assistant` 消息的 `message.usage`，旧格式 Codex 的 `content.type: 'codex'` 里的 `token_count`
    （happy-cli 7f178466c `codex/runCodex.ts` 原样转发 Codex 的 TokenCountEvent：只取 `info.last_token_usage`，
    即这一次请求的，`total_token_usage` 是累计的不能加；输入里含缓存，按 `pickTokenUsage` 的做法减去 `cached_input_tokens`，
    键里带上累计的 `total_tokens`，因为 Codex 每次更新限额都会把同一份 info 再发一遍）。按消息的 `createdAt`（server 时间）的本地日期归天，没有时退回信封里的时间。
    对照 happy-wire `sessionProtocol.ts`（`usage`）、happy-cli `claude/utils/sessionProtocolMapper.ts`（`attachUsageToLastEnvelope`）、
    `codex/utils/sessionProtocolMapper.ts`（`token_count`）。
  - 没有 usage 的时期：session 协议（happy-cli b0c781ce6，2026-02-12）之后，Claude 的信封在 `attachUsageToLastEnvelope`
    （538509172，2026-07-11）之前不带 usage，Codex 这段时间的 `token_count` 也不产生任何信封，所以这段时间（用当时的 CLI 跑的会话）
    热力图是空的，不是 bug。更早的 Claude 旧格式和 Codex 旧格式都有 usage，能统计。
  - 去重：Claude 一次回复按 content block 拆成几条消息，每条都带同一份 usage。旧格式按 `message.id` 去重；
    session 信封里没有 message id，用 `turn | subagent | 四个数` 当键。本次同步见过的键记在内存里；另外把 seq 最小和最大的那条的键存进缓存（`edge`），
    下次往前或往后接页时，跨在边界上的重复也挡得住。edge 只记 seq 最小和最大的那条：一次回复恰好被页边界切开、
    中间又夹着 subagent 和主 agent 交替的回复时，边上记的可能是别的回复的键，极少数情况下会重复算一次。
    Codex 的 usage 信封没有 turn，只按四个数去重。
  - 汇总读 `localStorage` 里所有 `happy.usage.*`（本次加载过的会话用内存里的），所以 server 上已删的会话照样计入；删除会话不清这个键，退出登录清掉。
  - 热力图的四档按这 53 周里有用量的那些天算四分位，更早的不算进去（否则很久以前的高峰会把现在的格子都压成浅色）。
  - 渲染 250ms 节流。热力图的格子只在第一天或最后一天变了（新的一天 / 一周）时重建，其余时候原地改 `data-level` / `title` / 月份，
    否则同步期间重画会吃掉刚好跨在重建上的点击；只有刚打开时滚到最右（最近一周）。
  - 读屏：`#usage-day`（aria-live）文字没变就不重写。`#usage-progress` 是看得见的计数，不是 live region；
    朗读交给隐藏的 `#usage-status`（role=status，`.sr-only`），每次打开页面只说一次「正在统计用量…」，结束时说最后的结果，
    中间「统计中 k / N」的每一步都不念。
    格子用 roving tabindex：只有选中的那天能 Tab 进去，←/→ 移一周、↑/↓ 移一天，移到哪天就选中哪天。
  - 缓存的 `days` 不是普通对象（数组、null）时当作没有缓存，这个会话重新统计。

## Mac 应用里才有的界面

- 页面在不在 Mac 应用里看 `desktop.active`（`desktop.js`）。浏览器自带、Electron 没有的东西要在两边打平，规范见 `../desktop/AGENTS.md` 的「和网页版打平」。
- ⌘F 查找（`find.js`）：只由 Mac 菜单的 `find` / `find-next` / `find-previous` / `find-selection` 命令打开，浏览器里不拦 ⌘F。
  用 CSS Custom Highlight API 画高亮，不改 DOM；不用 Electron 的 `findInPage`，它会连查找框里的字也匹配上。
  打开期间用 `MutationObserver` 跟着新消息重新计数（忽略查找栏自己的变化，否则会死循环）。

## 测试和验证

- `npm test`：跑 `test/*.test.mjs`（`node:test` + `node:assert/strict`）。新的逻辑模块要配一个测试文件，测试里构造真实的协议数据形状。
- `node --check app.js`：`app.js` 没有单测，改完至少查一下语法。
- 改了界面就要在浏览器里实际看一遍：`npm start`，打开 http://localhost:8080。
- 涉及 Mac 应用的（`desktop.js`、通知、角标、打包能否找到文件），再到 `../desktop` 跑 `npm run smoke`。
- 只测了逻辑、没在真实账号下看过界面时，交付时要说明。

## 文档

- 用户能感知的变化写进 [README.md](README.md) 对应的小节，新文件加进「文件」一节。
- 协议、缓存键、取舍这类实现要点写进本文件。
