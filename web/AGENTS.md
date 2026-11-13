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
  `happy.collapsed`、`happy.archivedOpen`、`happy.bgDismissed`、`happy.brand`、`happy.sideWidth`、`happy.sideCollapsed`、
  `happy.linksHidden`、`happy.links.<会话 id>`、`happy.lines.<会话 id>`，以及各模块自己的设置：`happy.defaults`（默认模型 / 强度 / 权限）、
  `happy.wallpaper` / `happy.wallpaper.image`（背景）、`happy.chatScale`（字号）、`happy.notify` / `happy.notifySound`（通知）。
- **从会话里解密出来的内容**（链接、文件路径之类）按会话缓存时，退出登录要清掉：加到 `logout()` 里按前缀删除的那一行。
- 读缓存要容错：用 `try/catch` 包住 `JSON.parse`，带上版本号 `v`，格式不对就当作没有缓存，重新算。
  写缓存也包 `try/catch`（配额可能满了，背景图本身就占 1.5 MB 左右）。
- 只存在本浏览器里的设置，在 README 里写明「只保存在这个浏览器里」。

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
- 实时推送走 Socket.IO：`new-message`、`update-session`、`new-session`，以及临时事件 `activity`（含 `thinking`）和
  `machine-activity`。断线时退回每 3 秒轮询正在看的会话，重连后补拉。

### 消息格式

- 新格式是 session protocol：`role: 'session'`，事件在 `content.data.ev`（或直接在 `content.ev`）里，
  `t` 有 `text`、`service`、`tool-call-start`、`tool-call-end`、`turn-start`、`turn-end`、`file`……
  `tool-call-start` 带 `call`、`name`、`title`、`args`；subagent 的事件带 `subagent`。
- 旧格式：Claude 的 `role: 'agent', content.type: 'output'`（`tool_use` 块），CLI 的状态事件 `content.type: 'event'`。
- 工具名：Claude 的（`Bash`、`Edit`、`Write`……），Codex 的（`CodexBash`、`CodexPatch`、`apply_patch`……），
  ACP（Cursor 等）的工具种类（`read`、`edit`、`delete`、`move`、`execute`……）。
  `CodexDiff` / `GeminiDiff` 是 CLI 每轮反复发送的累计 diff，**不是**一次修改。
- `/clear` 只回一条「Context was reset」事件；服务器上的历史消息不会删。

### RPC

- 会话 RPC（经 socket）：`permission`（批准 / 拒绝工具调用，回答 AskUserQuestion 时带 `updatedInput.answers`；
  Codex 有 `approved_for_session`）、`communication`（Codex / Happy Agent 的提问表单）、`abort`、`bash`、`killSession`（归档）。
- 机器 RPC：`spawn-happy-session`（新建会话）、`resume-happy-session`（恢复会话，带上会话密钥作为 fallback）、
  `bash`（worktree 的列出 / 新建 / 删除，见 `worktree.js`）。
- Codex 的模型列表经会话的 `bash` RPC 在那台电脑上查 `codex app-server`（`codexModels.js`），不用升级 Happy CLI。
- CLI 不在线时归档：网页自己用 `update-metadata` 写 `lifecycleState: "archived"`。

### 附件

- 图片用会话密钥派生的 `Happy Blobs` 密钥（secretbox）加密，经 `POST /v1/sessions/:id/attachments/request-upload` 拿到地址再上传，先发 file 事件再发文字。
  只发图片时自动补一句文字，因为 CLI 总会附一段文字，Claude 不接受空文字。
- 自托管服务器可能返回 `http://<它自己>/…` 的上传 / 下载地址，和服务器同主机的按服务器的 https 改写（`serverUrl.js`），
  否则 https 页面和 Mac 应用会当混合内容拦掉。

### 只能推断的状态

- 后台任务（`background.js`）：CLI 不转发后台任务的中间过程，还会丢掉 SDK 的任务结束消息，所以只能靠
  `<task-notification>` 判断结束，判断不了的让用户手动清除（`happy.bgDismissed`）。
  子 agent 自己在后台启动的命令，通知只发给那个子 agent，不要算进来，否则会一直显示在跑。
- 上下文剩余（`context.js`）：按最近一条回复的 `usage`（input + cache_creation + cache_read，subagent 的不算）和 CLI 盖上的 `context_window` 算。
- 订阅用量（`usage.js`）：来自 `agentState.usageLimits`，只有 Claude 会话上报。

### 扫历史的两套缓存

- 右栏链接（`links.js`）：打开会话后扫一遍历史，缓存在 `happy.links.<id>`，记录已覆盖的 seq 区间，下次只补新的。
- 改动行数（`lines.js`）：后台一次一个会话地同步所有在线会话加上正在看的那个（`wantLines` / `runLines`）。
  先用 `after_seq` 补新消息，再用 `before_seq` 往前扫到头；有刚打开的会话在排队时，往前扫的会话每翻一页就让一次。
  推送来的消息 seq 正好接上就直接累加，接不上就排队同步。失败后一分钟内不重试。缓存在 `happy.lines.<id>`。

## 测试和验证

- `npm test`：跑 `test/*.test.mjs`（`node:test` + `node:assert/strict`）。新的逻辑模块要配一个测试文件，测试里构造真实的协议数据形状。
- `node --check app.js`：`app.js` 没有单测，改完至少查一下语法。
- 改了界面就要在浏览器里实际看一遍：`npm start`，打开 http://localhost:8080。
- 涉及 Mac 应用的（`desktop.js`、通知、角标、打包能否找到文件），再到 `../desktop` 跑 `npm run smoke`。
- 只测了逻辑、没在真实账号下看过界面时，交付时要说明。

## 文档

- 用户能感知的变化写进 [README.md](README.md) 对应的小节，新文件加进「文件」一节。
- 协议、缓存键、取舍这类实现要点写进本文件。
