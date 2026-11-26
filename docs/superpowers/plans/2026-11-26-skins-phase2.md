# 皮肤和动效（第二步）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加上深海、星夜、像素三套皮肤，以及自定义贴图（飘落物 / 干完了 / 等你回答）。

**Architecture:** 沿用第一步：配色进 `skins.js`，场景和事件动效进 `effects.js`，侧栏图标用 CSS。贴图的读写和校验放新模块 `stickers.js`（可测），图片压缩在浏览器里做，`effects.setStickers()` 接收图片。

**Tech Stack:** 原生 ES module、Canvas 2D、CSS 自定义属性。

**Spec:** `docs/superpowers/specs/2026-11-26-skins-design.md`（第一步的计划和实现约定见 `2026-11-26-skins-phase1.md`、`web/AGENTS.md`「皮肤」一节）

## Global Constraints

- 同第一步：不加依赖、不用外部字体（Mac 应用离线也要能画）、模块 import 时不碰 DOM、画布 `pointer-events: none`、只用各平台字体都有的字形。
- 深海、星夜是深色（`dark: true`），像素是浅色。
- 贴图键：`happy.skin.sticker.fall` / `.done` / `.ask`，值是 `data:image/png;base64,…`，最长边 128px，每张不超过 200 000 个字符；格式不对当作没有。
- 不仿任何现成游戏的元素；像素皮肤只用通用的像素风（方块、像素云、彩纸、「+1」、「!」）。

## Review Focus

- 深色皮肤的发送键、主按钮上的文字和图标要看得清：深色皮肤给 `--on-accent` 深色值（旷野夜里一并补上）。
- 存储满了（背景图已占 1.5 MB）时上传贴图：给出能看懂的错误，不留半截数据。
- 苔绿也能用飘落物贴图：苔绿本身没有氛围，设了 `fall` 时照样飘。
- 动效「只在事件时」：飘落物贴图不飘，干完了的贴图照飞；「关闭」时都不画。
- 等你回答的贴图在所有皮肤上都显示，看不见的行不画、不让循环空转。

---

### Task 1: 三套配色

**Files:** Modify `web/skins.js`、`web/test/skins.test.mjs`

**Interfaces:** `SKINS` 顺序变为 `moss, sakura, wild, sea, star, pixel`；`paletteFor('sea'|'star', t).dark === true`，`paletteFor('pixel', t).dark === false`，三者不分时段。

- [ ] 测试：顺序；三者的 dark；每个配色都给全第一步的 KEYS；深色配色（sea、star、wild night）都设 `--on-accent`。→ FAIL → 实现（色值取自预览页：深海 `#0E2233/#0A1A28/#D6E8F2/#7FA0B3/#1C3A50/#3FD0C9`、星夜 `#1A1836/#121029/#EAE6FF/#9690C2/#2B2752/#9D8CFF`、像素 `#CFE3EF/#E4F1F8/#1E2430/#586776`，强调色 `#E8553B`）→ PASS → 提交 `feat(web): 新增深海、星夜、像素三套配色`。

### Task 2: `stickers.js`

**Files:** Create `web/stickers.js`、`web/test/stickers.test.mjs`

**Interfaces:**
- `SLOTS = ['fall', 'done', 'ask']`
- `readStickers(storage) -> { fall: string, done: string, ask: string }`（没有或不合法为 `''`）
- `setSticker(storage, slot, dataUrl)`：不合法的位置 / 图片抛 `Error`（中文消息）；`storage.setItem` 抛的配额错误原样抛出
- `removeSticker(storage, slot)`
- `prepareSticker(file) -> Promise<string>`（浏览器里：缩到最长边 128px，导出 PNG）

- [ ] 测试：空存储；存进去读回来；非 PNG data URL / 超长 / 未知位置抛错且不写入；remove 后为空；存储里被改坏的值读成 `''`。→ FAIL → 实现 → PASS → 提交 `feat(web): 自定义贴图的读写`。

### Task 3: 三套场景、贴图绘制、侧栏图标

**Files:** Modify `web/effects.js`（`setStickers({ fall, done, ask })`，参数是已加载的 `HTMLImageElement` 或 `null`）、`web/index.html`

- [ ] 深海：氛围是上浮的气泡 + 晃动的光带；发消息冒一串气泡；干完了三圈水波 + 往上飘的荧光；点击冒气泡。侧栏：工作中小气泡往上冒，等你回答声呐一样扩散（CSS）。
- [ ] 星夜：氛围是闪烁的星星 + 偶尔一颗流星；发消息一颗彗星从发送键往上飞；干完了一颗大流星划过 + 那一行冒出星光；点击冒星光。侧栏：工作中小卫星绕着转，等你回答金色 ✦ 闪。
- [ ] 像素：氛围是飘过的像素云；发消息方块迸开；干完了像素彩纸 + 「+1」；点击方块迸开。侧栏：工作中三个方块轮流跳，等你回答行尾冒「!」；输入框、自己的消息气泡改成 2px 硬边 + 错位阴影。
- [ ] 贴图：`fall` 替换各皮肤的小飘落物（花瓣、叶子、气泡、像素云、星星不替换——星星是场景），苔绿也飘；`done` 在原有动效外飞出 5 个；`ask` 在所有皮肤上的等待行行尾上下晃，旷野里替换小精灵。
- [ ] `node --check`；静态页截图看三套皮肤和事件；提交 `feat(web): 深海、星夜、像素三套皮肤的动效`。

### Task 4: 设置里的贴图 + 接线 + 文档

**Files:** Modify `web/app.js`、`web/index.html`、`web/README.md`、`web/AGENTS.md`

- [ ] 设置「皮肤」下加「自定义贴图」：三个色块（飘落物 / 干完了 / 等你回答），点了选图，设过的显示图和「清除」；错误显示在下面。`applyStickers()` 读存储、加载图片、调 `effects.setStickers`，启动时调用一次。
- [ ] README 皮肤表加三行、贴图说明（只保存在这个浏览器里、不进代码）；AGENTS 加 `happy.skin.sticker.*` 键和 `stickers.js`。
- [ ] 真实页面（假账号）截图设置页；提交 `feat(web): 自定义贴图`。

### Task 5: 收尾

- [ ] 整分支 review，修 Critical / Important；rebase、测试、合并、推送。
