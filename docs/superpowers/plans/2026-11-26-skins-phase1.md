# 皮肤和动效（第一步）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置里能选苔绿 / 樱花 / 旷野三套皮肤和动效强度，聊天区有氛围动效，发消息、干完了、等你回答、点空白处有事件动效，网页和 Mac 应用都有。

**Architecture:** `skins.js` 放纯数据和设置读写（可测）；`effects.js` 管两块画布和动画循环；`app.js` 把配色写进 `body` 行内样式、在状态变化处调用 effects；`index.html` 的写死颜色先收进变量。Mac 端加一个 `setAppearance(dark)` 桥接。

**Tech Stack:** 原生 ES module、Canvas 2D、CSS 自定义属性；Electron（desktop）。

**Spec:** `docs/superpowers/specs/2026-11-26-skins-design.md`

## Global Constraints

- 不加依赖；import 写相对路径；被 import 时不碰 `document` / `window` / `localStorage`（`effects.js` 只在调用 `createEffects` 时碰）。
- `localStorage` 键：`happy.skin` = `{ v: 1, id, motion }`，`motion` ∈ `full` | `events` | `off`。读失败当默认。
- 苔绿皮肤下界面和现在逐像素一致（变量默认值 = 原来的颜色）。
- 画布 `pointer-events: none`；`document.hidden` 时不画；没东西画时停 rAF。
- 不出现任何现成游戏的名字、标志、角色；旷野只用远山、古塔、宝箱、小精灵、符文、蝴蝶、萤火虫。
- 4 空格缩进、单引号、分号；注释英文，界面文字中文。

## Review Focus

- 系统开了「减少动态效果」、从没选过动效：默认 `off`，氛围和事件都不画，CSS 状态图标不转（已有的全局 reduced-motion 规则管住）。
- 旷野跨过 17:00 / 19:00：不刷新页面，一分钟内切到黄昏 / 夜里，Mac 侧栏跟着变深。
- 侧栏行不可见（手机在聊天里、分组折叠、行滚出视野）时干完了：当前会话改在发送键处演，其余不演，不在屏幕外坐标画东西。
- 心跳抖动导致 `isThinking` 短时间真假来回：同一会话 3 秒内只演一次干完了。
- 设了背景图片又选深色时段：图片上的遮罩用当前 `--sheet` / `--paper`，而不是写死的浅色。

---

### Task 1: `skins.js` 皮肤定义和设置

**Files:**
- Create: `web/skins.js`
- Test: `web/test/skins.test.mjs`

**Interfaces:**
- Produces:
  - `SKINS: { id, name, chip, scene }[]`（顺序：`moss`、`sakura`、`wild`；`chip` 是 CSS background 字符串，`scene` 是 effects 用的场景名，等于 id）
  - `readSkin(storage, reducedMotion: boolean) -> { id, motion }`
  - `setSkin(storage, id)`、`setMotion(storage, motion)`
  - `timeOfDay(date: Date) -> 'day' | 'dusk' | 'night'`
  - `paletteFor(id, time) -> { vars: Record<string,string>, dark: boolean }`（`moss` 的 `vars` 为空对象）

- [ ] **Step 1: 写失败的测试**：未存过 → `{ id: 'moss', motion: 'full' }`；`reducedMotion: true` 且未存过 → `motion: 'off'`；存过 `events` 时 reducedMotion 不覆盖；坏 JSON / 未知 id / 未知 motion 回到默认；`setSkin` 后 `readSkin` 拿回来且保留 motion；`timeOfDay` 5:59→night、6:00→day、16:59→day、17:00→dusk、18:59→dusk、19:00→night；`paletteFor('wild','night').dark === true`，`paletteFor('wild','day').dark === false`；`paletteFor('sakura','night')` 与 `'day'` 相同（只有旷野分时段）；每个非苔绿配色都含 `--paper --sheet --ink --muted --rule --moss --moss-tint --surface`。
- [ ] **Step 2:** `cd web && node --test test/skins.test.mjs` → FAIL（模块不存在）。
- [ ] **Step 3: 实现**。配色取自预览页：樱花 `--paper #F7E9EC --sheet #FFF8F9 --ink #3D2A31 --muted #9A7F87 --rule #F0D9DF --moss #D35D7C --moss-tint #FBE0E7 --amber #E08A3C`；旷野白天 `--paper #E6EBD6 --sheet #F6F4E9 --ink #2E3326 --muted #7A8068 --rule #DAD6BF --moss #D9822B --moss-tint #E3EAD0 --amber #C2452D`，黄昏改 `--paper #EFE4D2 --sheet #FAF1E6 --rule #E6D7C0 --moss-tint #F1E2CF`，夜里 `--paper #1C2530 --sheet #141C25 --ink #E4E8DA --muted #8B9686 --rule #2A3540 --moss #E89A45 --moss-tint #222F3C --amber #E86A50 --surface #1B2530`。其余派生变量（`--ink-rgb`、`--head`、`--head-hover`、`--code-bg`、`--accent-hover`、`--glass`、`--sel`、`--ring`、`--menu`）各配色给全。
- [ ] **Step 4:** 测试 PASS；`npm test` 全绿。
- [ ] **Step 5:** 提交 `feat(web): 新增皮肤定义和设置读写`。

### Task 2: 写死的颜色收进变量

**Files:**
- Modify: `web/index.html`（`:root`、全部写死颜色处、Mac 一节）、`web/wallpaper.js`（`wallpaperStyle(w, veil)`）、`web/test/wallpaper.test.mjs`

**Interfaces:**
- Produces: CSS 变量 `--surface --ink-rgb --head --head-hover --amber --code-bg --accent-hover --on-accent --idle --faint --add --del --danger-tint`；`body.dark` 下的 markdown / highlight.js 深色覆盖；`wallpaperStyle(w, veil = { sheet: '252, 252, 250', paper: '242, 243, 239' })`。

- [ ] **Step 1: 测试**：`wallpaperStyle({kind:'image',...}, { sheet: '20, 28, 37', paper: '28, 37, 48' })` 的 `main.backgroundColor` 是 `rgba(20, 28, 37, 0.6)`；不传第二个参数时结果和现在一样。
- [ ] **Step 2:** 跑测试 → FAIL。
- [ ] **Step 3:** 改 `wallpaperStyle`；`index.html` 替换：`#fff` 表面 → `var(--surface)`，`rgba(38, 42, 39, x)` → `rgba(var(--ink-rgb), x)`，`#E9EBE5/#E3E6DF` → `--head/--head-hover`，`#B7791F` → `--amber`，`#F6F7F4` → `--code-bg`，`#4A6450` → `--accent-hover`，codex / cursor 图标色 → `var(--ink)`，Mac 卡片 / 按钮 / 弹窗 / 菜单底色用 `color-mix(in srgb, var(--surface|--sheet) N%, transparent)`。加 `body.dark` 规则：`.hljs` 文字 `var(--ink)` 和一组深色 token 色、`.markdown-body table td/th` 边框 `var(--rule)`、行内 `code` 底色。
- [ ] **Step 4:** `npm test` 全绿；浏览器截图对比改前改后苔绿外观一致（`npm start` + headless 截设置页和登录页）。
- [ ] **Step 5:** 提交 `refactor(web): 界面颜色收进变量，为皮肤做准备`。

### Task 3: 应用皮肤 + 设置页

**Files:**
- Modify: `web/app.js`（新 `applySkin()`、`renderSkinSetting()`，在 `applyWallpaper()` 旁）、`web/index.html`（设置页「皮肤」「动效」两栏，放在「背景」之前；`.swatch` 复用）、`web/README.md`（设置一节、文件一节）、`web/AGENTS.md`（`happy.skin` 键、皮肤实现要点）

**Interfaces:**
- Consumes: Task 1 全部导出。
- Produces: `applySkin()`：写 `body` 行内变量（先清掉上次写过的键）、`body.dataset.skin/time`、`body.classList.toggle('dark')`、`<meta name="theme-color">` = `--paper`、调用 `applyWallpaper()`（遮罩跟着变）、`desktop.setAppearance(dark)`、`effects.setSkin(id, motion, time)`；每 60 秒重算一次时段。

- [ ] **Step 1:** 实现；`node --check app.js`。
- [ ] **Step 2:** 浏览器里切换三套、三档动效，截图确认设置页和聊天区配色正确，夜里深色可读（消息、代码块、菜单、对话框）。
- [ ] **Step 3:** 提交 `feat(web): 设置里可以换皮肤`。

### Task 4: 动效（`effects.js`）+ 接到会话状态

**Files:**
- Create: `web/effects.js`
- Modify: `web/index.html`（两块画布的样式、`main { isolation: isolate }`、各皮肤的侧栏状态图标和旷野符文）、`web/app.js`（`send()` 成功后、`trackActivity` / `onEphemeral` 的 `isThinking` 由真变假处、`main` 的 `pointerdown`）、`web/README.md`

**Interfaces:**
- Consumes: `SKINS[].scene`、`timeOfDay`。
- Produces: `createEffects({ main: HTMLElement }) -> { setSkin(scene, motion, time), send(el), done(rowEl), click(x, y) }`。

- [ ] **Step 1:** 实现画布、循环（hidden 暂停、空闲停 rAF、resize 跟随 `main`）、三个场景：苔绿（无氛围；干完了涟漪 + 圆点；点击小涟漪）、樱花（飘花瓣；发送花瓣；干完了花瓣爆开；点击花瓣）、旷野（天色、远山、古塔、云、鸟、草、风、叶，夜里星月萤火虫；发送风和叶；干完了宝箱 + 星点 + 蝴蝶/萤火虫；等你回答小精灵绕行；点击惊起蝴蝶/萤火虫并吹弯草）。
- [ ] **Step 2:** 接线：干完了用 `doneEffect(s)`（3 秒节流；行不可见且是当前会话时用 `$('send')`；`waitingSets(s).length` 时不演）。
- [ ] **Step 3:** 侧栏状态图标 CSS：樱花工作中转小花、等你回答整行轻摆；旷野工作中罗盘、等你回答小旗、`.msg.thinking-now .label::after` 符文。
- [ ] **Step 4:** `node --check app.js effects.js`；浏览器里实际看：切到樱花、旷野，发一条消息，等它干完，截图。
- [ ] **Step 5:** 提交 `feat(web): 皮肤动效（苔绿、樱花、旷野）`。

### Task 5: Mac 深浅色桥接

**Files:**
- Modify: `desktop/preload.js`（`setAppearance(dark: boolean)`）、`desktop/main.js`（`bridge()` 里 `ipcMain.on('desktop:appearance', …)`，设 `nativeTheme.themeSource`）、`web/desktop.js`（`desktop.setAppearance(dark)`，浏览器里无操作）、`desktop/smoke.js`（页面调用后主进程收到）、`desktop/AGENTS.md`（`nativeTheme` 一条改写）、`web/test/desktop.test.mjs`

- [ ] **Step 1:** 测试：`createDesktop(bridge).setAppearance(true)` 调用 `bridge.setAppearance(true)`；同值不重复调用；没有 bridge 时不抛。
- [ ] **Step 2:** 实现四处；`npm test`；`cd desktop && xvfb-run -a npx electron --no-sandbox smoke.js`。
- [ ] **Step 3:** 提交 `feat(desktop): 深色皮肤下侧栏毛玻璃跟着变深`。

### Task 6: 收尾

- [ ] 整分支 review（一个新的 reviewer），修掉问题。
- [ ] `git fetch origin && git rebase origin/main`，`npm test`，主 checkout `git merge --ff-only`，`git push origin main`。
