# happy-web-mini · web

最小的 Happy Web 客户端，直连官方 server（`https://api.cluster-fluster.com`）。无构建步骤。

```bash
npm install
npm start            # python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
# 远程机器：ssh -L 8080:localhost:8080 <host>，再在本机打开 localhost
```

http 下也能用（加解密是纯 JS 实现），但页面可能被中间人篡改，条件允许时用 https 或 ssh 转发。

## 能做什么

- 登录：扫码关联（手机 App › 关联新设备，扫 `happy:///account?…`），或粘贴备份密钥
- 会话列表只显示在线会话（`active` 且 15 分钟内有活动，未归档，非侧聊），按电脑分组（可折叠），
  同一项目的会话排在一起，`.dev/worktree/*` 归到所属仓库。排序只用名字和创建时间，心跳不会打乱顺序
- agent 正在工作时，列表里那一行前面亮绿点；已归档的会话打开后只读
- 列表最下面是可折叠的「已归档」（默认收起，开合记在本浏览器）：按归档时间从新到旧，每行带电脑、项目和归档日期，
  一次显示 30 个，「再显示」继续加载
- 实时：Socket.IO 推送新消息（`new-message`）、会话变化（`update-session`）和「正在思考」（`activity` 的 `thinking`）；
  断线时退回每 3 秒轮询，重连后补拉。列表另外每 30 秒按 `changedSince` 增量刷新
- agent 回复按 Markdown 渲染（marked 解析，DOMPurify 过滤 HTML），样式用 github-markdown-css，代码块用 highlight.js 高亮（github 主题，没标语言时自动识别）
- 复制：鼠标移到代码块上，右上角（语言标签旁）出现复制按钮，复制代码原文；移到 agent 回复上，下方出现复制按钮，复制整条回复的 Markdown 原文。
  点后变成对勾 1.5 秒。https / localhost / Mac 应用里用 Clipboard API，http 下退回 `execCommand('copy')`；触屏设备上按钮常驻
- 换模型和思考强度：输入框下方选择，记在本机（按会话），随消息放进 `meta.model` / `meta.effort`
  （Happy Agent 会话再带 `modelProviderId`）；强度档位随模型变化
- 工具调用按轮次折叠：一轮里的中间文字和工具调用收在「已工作 7分2秒」下面，最后的回答留在外面；进行中显示
  「正在工作 12秒」实时走秒，正在跑的工具也显示已用时间，结束后自动折叠。工具行是图标加命令/路径/搜索词，点开看完整参数
- 回答 agent 的提问：Claude 的 AskUserQuestion（`agentState.requests`，经 `permission` RPC 带 `updatedInput.answers`
  批准）和 Codex / Happy Agent 的表单（`agentState.communications`，经 `communication` RPC）。卡片在输入框上方，
  支持单选、多选、自填和「不回答」；列表里等待回答的会话标「等你回答」
- 发图片：点「图片」、粘贴或拖进输入框，最多 10 张；超过 2000px 或 3.5MB 的转成 JPEG。图片用会话密钥派生的
  `Happy Blobs` 密钥（secretbox）加密，经 `request-upload` 传到 S3（或自托管服务器 PUT），先发 file 事件再发文字；
  只发图片时自动补一句「请看这张图片。」（CLI 总会附一段文字，Claude 不接受空文字）。聊天里的图片下载后在本地解密显示
- 打开会话只取最新 100 条（`before_seq`），向上滚动再一页页加载更早的，位置不跳；
  打开过的会话缓存在页面里，再次打开直接显示并回到上次滚动位置
- 订阅用量：Claude 会话在输入框下方显示「5 小时 42% · 7 天 18% · 截至 14:05」，来自 `agentState.usageLimits`
  （CLI 每轮对话后更新，是那台电脑上登录的 Claude 账号的额度）。≥90% 琥珀色、用尽红色，其他窗口（如 7 天 Opus）
  接近上限时才出现；悬停看每个窗口的重置时间。Codex / Gemini 会话不上报，不显示
- 斜杠命令联想：输入框里打 `/` 弹出可用命令，来自会话 metadata 的 `slashCommands` 和 `skills`（skill 会标出来），
  外加 compact / clear / goal / mcp / skills；去掉 help、config 这类只在终端里有意义的。前缀匹配优先，↑↓ 选，回车或 Tab 补全，Esc 关
- CLI 的状态事件（`/clear` 回的「上下文已清空」、压缩开始/完成、中止等）显示成灰色提示行，并结束「等待回复」。
  和官方 App 一样，`/clear` 只重置 agent 的上下文，服务器上的历史消息不会删，所以聊天记录仍在
- 新建会话：左下角「新建会话」，选电脑（`GET /v1/machines`，用机器密钥解 metadata）、填目录（`~` 按那台电脑的 homeDir 展开，
  下面列出这台电脑上用过的项目目录）、选 agent（按 `cliAvailability`）。经机器 RPC `spawn-happy-session` 让 daemon 启动；
  目录不存在时先确认再创建。启动后自动打开新会话
- 发送文本消息（AES-256-GCM 加密后 `POST /v3/sessions/:id/messages`）
- 归档：通过 Socket.IO 让 CLI `killSession`（CLI 结束进程并写上 archived）；CLI 不在线时
  web 自己用 `update-metadata` 写 `lifecycleState: "archived"`
  归档成功后自动打开列表里的下一个在线会话（它是最后一个就打开上一个）；归档过程中切走了就不跳

- 设置页（侧栏顶部「设置」）：Claude / Codex / Gemini 各自的默认模型和强度，存在本浏览器。给会话发消息时没在输入框下方单独选，
  就按默认发（输入框显示「默认：…」）；Happy Agent 会话不套用。退出登录也在这里。还可以改左上角的名字（同时用作标签页标题），留空恢复成 Happy
- 左侧状态图标加「完成未读」：会话空闲、且有比本浏览器看过的更新的消息（按会话 `seq` 比较，存 localStorage）时显示绿色实心点并加粗；
  打开即已读，正在看的会话新消息直接算已读，第一次见到的会话不标未读。打开页面时直接打开列表里第一个未读会话，没有未读就打开列表第一个
- 侧栏宽度可以拖动侧栏右边缘调整（220px 到窗口宽度减 360px，最宽 640px），双击恢复 300px；获得焦点后也能用 ←→ 调。宽度存在本浏览器。侧栏右上角的按钮（或 Ctrl/⌘ + B）收起侧栏，收起后聊天区左上角出现展开按钮；收起状态也记在本浏览器。手机上没有这两个按钮
- 浏览器通知：设置 › 通知 打开（会请求浏览器权限），会话完成未读或开始等你回答、而这个标签页不在前台时发系统通知，点通知回到页面并打开那个会话。判断和 Mac 应用共用（`desktop.js`），刚打开页面时已有的未读不补发。需要 https 或 localhost。Mac 应用里是同一个开关，默认打开、不用授权
- 标签页标题带上需要你的会话数，如「(2) Happy」（完成未读 + 等你回答，和 Mac 应用的 Dock 角标同一个数）
- 每个会话各自保存输入框草稿；斜杠命令不再限 50 条，新会话还没上报时借用同一台电脑上最近会话的列表

## 不做什么

取消归档、逐字流式（协议里没有增量）、其他工具的权限审批、恢复会话、非图片附件、旧版 secretbox 会话。

## 注意

账户主密钥存在 `localStorage`，任何能在这个 origin 跑 JS 的东西都能读到它。只在自己信任的机器和域名上用。

## Mac 应用

`../desktop/` 把这个页面打包成 macOS 应用，功能和网页一致，另外有菜单、Dock 角标和系统通知，见 [desktop/README.md](../desktop/README.md)。
改了网页之后要重新打包（`cd ../desktop && npm run build`）；`npm run check` 会告诉你 `dist/` 里的包是不是已经落后于网页。

## 文件

- `crypto.js` — 密钥派生 / 数据密钥解包 / AES-GCM / 备份密钥解析，对照 happy-ios 的 crypto 测试向量验证过
- `app.js` — 登录、会话列表、消息收发、实时推送、归档
- `models.js` — 每种 agent 可选的模型，对照 iOS 的 ModelModeOptions / AgentDefaults
- `markdown.js` — Markdown 渲染、代码高亮和 HTML 过滤
- `questions.js` — 找出待回答的问题、组装回答和拒绝的 RPC，对照 iOS 的 AgentCommunications
- `usage.js` — 订阅用量窗口的排序、文案和提示，对照 iOS 的 SessionComposerRules.usageLimitRows
- `commands.js` — 斜杠命令列表、搜索、光标处 `/词` 的识别和替换，对照 iOS 的 ComposerAutocomplete
- `defaults.js` — 默认模型/强度的存取和对某个会话是否适用
- `tools.js` — 每种工具的图标、一行摘要和详情，时长格式；图标用 Lucide（`lucide-static`，按需引入单个图标）
- `attachments.js` — 图片压缩、加密上传、file 事件、下载解密，对照 iOS 的 HappyAPI+Attachments / BlobCipher
- `desktop.js` — 需要你的会话数（Mac 应用的 Dock 角标 / 浏览器的标签页标题）和系统通知，两边共用一个开关
- `test/` — `npm test`
- `index.html` — 页面和样式
