# happy-web-mini · web

最小的 Happy Web 客户端，直连官方 server（`https://api.cluster-fluster.com`）。无构建步骤。

```bash
npm install
npm start            # 先写 build-info.json（当前提交，给 设置 › 关于 用），再 python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
# 远程机器：ssh -L 8080:localhost:8080 <host>，再在本机打开 localhost
```

http 下也能用（加解密是纯 JS 实现），但页面可能被中间人篡改，条件允许时用 https 或 ssh 转发。

## 能做什么

- 登录：扫码关联（手机 App › 关联新设备，扫 `happy:///account?…`），或粘贴备份密钥
- 会话列表只显示在线会话（`active` 且 15 分钟内有活动，未归档，非侧聊），按电脑分组（可折叠）。每台电脑下分
  「Bot」（metadata 里有 `bot`，Happy Agent 的 bot，按 `orderKey` 排）和「任务」（有 `task`，显示 `~/Tasks/…`），
  和官方 App 的判断一样；其余会话不加标签，直接排成树：项目目录 › 它自己的会话，再下一层是各个 worktree › 会话；
  Happy Agent 会话按它上报的 `project` / `workspace` 分，其他按目录分，`.dev/worktree/*` 归到所属仓库的 worktree 节点下。
  电脑、项目和 worktree 都能单独折叠（记在本浏览器），折起来时里面有等你批准 / 回答（琥珀色）或未读（绿色）的会话，标题后面亮个点。
  排序只用名字、`orderKey` 和创建时间，心跳不会打乱顺序
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
- Codex 模型从会话所在电脑的 `codex app-server` 查询，名称、顺序和强度档位跟 Codex CLI 的模型菜单一致，
  包括自定义 provider 的模型（例如 Ferry、Max 1M 和排队标记）；悬停模型可看 CLI 的描述。
  打开在线 Codex 会话、设置页或模型菜单时查询，每个会话缓存 1 分钟；设置页使用当前 Codex 会话，
  当前不是 Codex 时使用最近的在线 Codex 会话。查询失败保留上次结果，没有结果时使用备用列表，悬停菜单可看来源状态。
  通过 Happy 已有的 `bash` RPC 查询，无需升级 Happy CLI；只读取配置和模型列表，不创建对话
- 权限模式：输入框下方第三个下拉（设置页也能给每个 agent 设默认），随消息放进 `meta.permissionMode`，不选就不带、由 Happy CLI 决定。
  Claude：默认 / 自动接受编辑（`acceptEdits`）/ 计划模式（`plan`）/ YOLO（`bypassPermissions`）；Codex：自动（`auto`，CLI 的默认）/ 谨慎（`default`）/
  只读（`read-only`）/ 工作区放行（`safe-yolo`）/ YOLO（`yolo`）；Gemini：默认 / 只读 / 工作区放行 / YOLO。Happy Agent 会话不显示。
  批准 Claude 的计划后，这个会话的选择自动改成「默认」（CLI 也会退出计划模式，不然下一条又会带 `plan` 回去）。CLI 不接受 Claude 从 YOLO 直接降回「默认」，要降级选「自动接受编辑」或「计划模式」
- Codex 的模型列表最前面是「跟随 Codex 配置」（输入框下方和设置页的默认模型都能选）：发 `model: null`（没选强度时再加 `effort: null`），
  Happy CLI 就不再用它内置的默认模型（1.2.6 是 `gpt-6.1-sol`）和默认强度，Codex 按那台电脑 `~/.codex/config.toml` 里的
  `model` / `model_provider` / `model_reasoning_effort` 来。模型在 Codex 建 thread 时就定了，要在会话的第一条消息（或 `/clear` 之后）就是这个选项才生效
- 工具调用按轮次折叠：一轮里的中间文字和工具调用收在「已工作 7分2秒」下面，最后的回答留在外面；进行中显示
  「正在工作 12秒」实时走秒，正在跑的工具也显示已用时间，结束后自动折叠。工具行是图标加命令/路径/搜索词，点开看完整参数
- 后台任务：一轮结束后还在跑的后台 subagent / 命令（`run_in_background`，或用 SendMessage 唤醒的已有 agent）在对话末尾显示「后台运行中：A 等 2 个」，收到 `<task-notification>` 才算结束。子 agent 自己在后台启动的命令不算：它的通知只发给那个子 agent，这边收不到，算上就会一直显示在跑。即使是主 agent 的，Happy CLI 也会丢掉 SDK 的任务结束消息，agent 正忙时结束的任务这边收不到结束信号，所以展开后每条后面有 ×（多条时还有「全部清除」），手动清掉，记在本浏览器；它被 SendMessage 再次唤醒时会重新显示。点开列出每一个和已运行时长，点某一个跳到启动它的工具调用（展开所在轮次和参数，能看到给它的 prompt）。CLI 不转发后台任务的中间过程，所以只看得到它在跑、跑了多久，看不到它在做什么。这时列表里那一行也照样转圈（悬停提示「后台运行中」）；只认在本浏览器打开过的会话，没打开过的不拉历史、不知道有没有后台任务
- 回答 agent 的提问：Claude 的 AskUserQuestion（`agentState.requests`，经 `permission` RPC 带 `updatedInput.answers`
  批准）和 Codex / Happy Agent 的表单（`agentState.communications`，经 `communication` RPC）。卡片在输入框上方，
  支持单选、多选、自填和「不回答」；列表里等待回答的会话标「等你回答」
- 批准工具调用：`agentState.requests` 里除 AskUserQuestion 以外的请求（Codex 的命令 `CodexBash`、改文件 `CodexPatch`、应用 / MCP 工具，
  Claude 权限模式外的工具和计划模式的 ExitPlanMode）在输入框上方显示审批卡片：要做什么（命令、文件、工具名和参数）、在哪个目录，
  「完整内容」展开看全部参数。「允许 / 拒绝」经 `permission` RPC 发 `{ id, approved, decision }`；Codex 会话还有「本会话都允许」
  （`approved_for_session`，同类请求不再问）。列表里标「等你批准」，算进角标和通知。之前网页不显示这类请求，会话会一直卡着
- 发图片：点「图片」、粘贴或拖进输入框，最多 10 张；超过 2000px 或 3.5MB 的转成 JPEG。图片用会话密钥派生的
  `Happy Blobs` 密钥（secretbox）加密，经 `request-upload` 传到 S3（或自托管服务器 PUT），先发 file 事件再发文字；
  只发图片时自动补一句「请看这张图片。」（CLI 总会附一段文字，Claude 不接受空文字）。聊天里的图片下载后在本地解密显示。
  自托管服务器在没配 `PUBLIC_URL`、反向代理也不传 `X-Forwarded-Proto` 时，返回的上传 / 下载地址是 `http://<它自己>/…`；
  和服务器同主机的这种地址按服务器的 `https` 改写后再用（`serverUrl.js`），否则 Mac 应用和 https 页面会当混合内容拦掉（Failed to fetch），也带不上 token
- 打开会话只取最新 100 条（`before_seq`），向上滚动再一页页加载更早的，位置不跳；
  打开过的会话缓存在页面里，再次打开直接显示并回到上次滚动位置
- 订阅用量：Claude 会话在输入框下方显示「5 小时 42% · 7 天 18% · 截至 14:05」，来自 `agentState.usageLimits`
  （CLI 每轮对话后更新，是那台电脑上登录的 Claude 账号的额度）。≥90% 琥珀色、用尽红色，其他窗口（如 7 天 Opus）
  接近上限时才出现；悬停看每个窗口的重置时间。Codex / Gemini 会话不上报，不显示
- 上下文剩余：输入框下方订阅用量前面显示「上下文剩 63%」，按最近一条回复带的 `usage` 算（input + cache_creation + cache_read，subagent 的不算），窗口大小用 CLI 盖上的 `context_window`（SDK 报的真实值，200K / 1M 都对）。会话第一轮还不知道窗口时只显示「上下文 74K」。剩 ≤25% 琥珀色、≤10% 红色，悬停看已用 / 总量。Claude 和 Codex 会话都有，压缩后下一条回复才会降下来
- 输入历史：输入框为空时按 ↑ 回填这个会话里上一条发过的消息（来自已加载的聊天记录，手机上发的也算，连续重复的只算一条），再按 ↑ 往前翻，↓ 往回，翻过最新一条回到空输入框。多行内容里光标不在第一行 / 最后一行时照常移动光标；改动了回填的内容就不再翻
- 链接汇总：会话里出现过的 MR / PR（Codebase、GitLab、GitHub）、飞书文档（文档 / Wiki / 表格 / 多维表格等）和其他链接，按组列在右栏（「其他链接」默认收起）。只看你和 agent 写的文字，工具调用和输出里的 URL 不算；同一个链接只列一次，记最早出现的那次，后面注「提到 N 次」。打开会话后在后台把更早的历史扫一遍（只解密、不渲染），结果按会话存在本浏览器（`happy.links.<会话 id>`），下次只补新的；扫描失败时右栏底部可以重试。点名字在新标签页打开，点下面的「你 / agent · 时间」跳回原文（没载入就先往上加载，在折叠的轮次里就展开）。主区够宽（≥ 1476px）时常驻在右边距，× 可以收起（记在本浏览器）；窄屏或收起后，从标题栏的链接按钮弹出
- 斜杠命令联想：输入框里打 `/` 弹出可用命令，来自会话 metadata 的 `slashCommands` 和 `skills`（skill 会标出来），
  外加 compact / clear / goal / mcp / skills；去掉 help、config 这类只在终端里有意义的。前缀匹配优先，↑↓ 选，回车或 Tab 补全，Esc 关
- CLI 的状态事件（`/clear` 回的「上下文已清空」、压缩开始/完成、中止等）显示成灰色提示行，并结束「等待回复」。
  和官方 App 一样，`/clear` 只重置 agent 的上下文，服务器上的历史消息不会删，所以聊天记录仍在
- 新建会话：左下角「新建会话」，选电脑（`GET /v1/machines`，用机器密钥解 metadata）、填目录（`~` 按那台电脑的 homeDir 展开，
  下面列出这台电脑上用过的项目目录）、选 agent（按 `cliAvailability`）。经机器 RPC `spawn-happy-session` 让 daemon 启动；
  目录不存在时先确认再创建。启动后自动打开新会话
- 新建会话时可以顺手建 worktree：目录下面的「Worktree」选「新建 worktree」，会经机器 RPC `bash` 在仓库根目录执行
  `git worktree add -b <形容词-名词> .dev/worktree/<名字>`（和官方 App 一样，重名加 -2…-4），再在新 worktree 里启动会话；
  也能直接选这个仓库已有的 worktree（`git worktree list`）。目录不是 git 仓库时「新建」不可选
- 发送文本消息（AES-256-GCM 加密后 `POST /v3/sessions/:id/messages`）
- 归档：通过 Socket.IO 让 CLI `killSession`（CLI 结束进程并写上 archived）；CLI 不在线时
  web 自己用 `update-metadata` 写 `lifecycleState: "archived"`
- 归档的是某个 `.dev/worktree/*` 里最后一个在线会话时，点归档的对话框里多一项「同时删除 worktree」（默认勾上，电脑离线时不可选），
  和进程会中断的提醒放在一起，点完不用再等。归档成功后经机器 RPC `bash` 执行 `git worktree remove`
  （有未提交的修改或未跟踪的文件时再确认一次才加 `--force`），分支用 `git branch -d` 删，没合并的保留
  归档成功后自动打开列表里的下一个在线会话（它是最后一个就打开上一个）；归档过程中切走了就不跳

- 设置页（侧栏顶部「设置」）：Claude / Codex / Gemini / Cursor 各自的默认模型和权限，支持的 agent 还可设默认强度，存在本浏览器。
  Cursor 模型来自当前 Cursor 会话上报的列表；当前会话还没有列表或不是 Cursor 时，优先使用最近的在线 Cursor 会话，再使用历史会话的列表。
  没有列表时提示先启动 Cursor 会话，收到列表后自动更新。默认模型只对上报支持该模型的会话生效。给会话发消息时没在输入框下方单独选，
  就按默认发（输入框显示「默认：…」）；Happy Agent 会话不套用。退出登录也在这里。还可以改左上角的名字（同时用作标签页标题），留空恢复成 Happy。最下面「关于」显示版本号和提交号（读页面旁边的 `build-info.json`：Mac 应用打包时写，浏览器版 `npm start` 时写，所以是启动服务那一刻的代码；带「含未提交的改动」表示当时工作区有改动）
- 设置页的「背景」：默认、米黄、雾灰、薄荷、天蓝、浅粉几种预设，自定义颜色，或者自己的图片。颜色只染聊天区（右侧，含设置页）；
  图片铺满整个窗口，左右两栏各叠一层底色（侧栏比聊天区深 15%，电脑卡片也变半透明，两栏仍分得开）。
  图片在浏览器里压成 JPEG（最长边 2560px，不超过约 1.5 MB）存 localStorage，「淡化」滑块调底色深浅（默认 60%）；
  换成颜色时图片还留着，点「图片」就能换回来，「移除图片」才删掉。只保存在这个浏览器里
- 左侧状态图标加「完成未读」：会话空闲、且有比本浏览器看过的更新的消息（按会话 `seq` 比较，存 localStorage）时显示绿色实心点并加粗；
  打开即已读，正在看的会话新消息直接算已读，第一次见到的会话不标未读。打开页面时直接打开列表里第一个未读会话，没有未读就打开列表第一个
- 侧栏右键菜单：会话行上可以打开、标为已读/未读、在这个项目新建会话、复制目录路径或会话 ID、归档（不用先打开它）；电脑分组上可以在这台电脑上新建会话、全部标为已读、收起/展开；项目和 worktree 上可以在这里新建会话、复制路径。↑↓ 选，回车执行，Esc 或点别处关闭
- 侧栏宽度可以拖动侧栏右边缘调整（220px 到窗口宽度减 360px，最宽 640px），双击恢复 300px；获得焦点后也能用 ←→ 调。宽度存在本浏览器。侧栏右上角的按钮（或 Ctrl/⌘ + B）收起侧栏，收起后聊天区左上角出现展开按钮；收起状态也记在本浏览器。手机上没有这两个按钮
- 浏览器通知：设置 › 通知 打开（会请求浏览器权限），会话完成未读或开始等你回答、而这个标签页不在前台时发系统通知，点通知回到页面并打开那个会话。判断和 Mac 应用共用（`desktop.js`），刚打开页面时已有的未读不补发。需要 https 或 localhost。Mac 应用里是同一个开关，默认打开、不用授权，另外可以关掉「通知带提示音」
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
- `models.js` — 每种 agent 可选的模型和强度，Codex 优先使用 CLI 的实际列表，其余对照 iOS 的 ModelModeOptions / AgentDefaults
- `codexModels.js` — 经会话的 `bash` RPC 查询 Codex 配置和完整模型列表，按会话缓存、失败后重试
- `markdown.js` — Markdown 渲染、代码高亮和 HTML 过滤
- `questions.js` — 找出待回答的问题、组装回答和拒绝的 RPC，对照 iOS 的 AgentCommunications
- `usage.js` — 订阅用量窗口的排序、文案和提示，对照 iOS 的 SessionComposerRules.usageLimitRows
- `commands.js` — 斜杠命令列表、搜索、光标处 `/词` 的识别和替换，对照 iOS 的 ComposerAutocomplete
- `defaults.js` — 默认模型/强度的存取和对某个会话是否适用
- `tools.js` — 每种工具的图标、一行摘要和详情，时长格式；图标用 Lucide（`lucide-static`，按需引入单个图标）
- `attachments.js` — 图片压缩、加密上传、file 事件、下载解密，对照 iOS 的 HappyAPI+Attachments / BlobCipher
- `worktree.js` — worktree：列出、新建、归档最后一个会话后删除（经 daemon 的 `bash` RPC）
- `wallpaper.js` — 背景（聊天区的颜色、整个窗口的图片）：读写设置（localStorage）、生成样式、把选的图片压缩成 data URL
- `desktop.js` — 需要你的会话数（Mac 应用的 Dock 角标 / 浏览器的标签页标题）和系统通知，两边共用一个开关
- `links.js` — 右栏链接：从 Markdown 里提取、分类（MR / 飞书文档 / 其他）、按 URL 去重，以及分页扫描历史、和本地缓存的区间衔接
- `test/` — `npm test`
- `index.html` — 页面和样式
