# desktop/AGENTS.md

Mac 应用（Electron）的开发规范。仓库级的规范（worktree、提交、发版）见 [../AGENTS.md](../AGENTS.md)，
网页本身的规范见 [../web/AGENTS.md](../web/AGENTS.md)，使用说明见 [README.md](README.md)。

## 定位

这里是一层薄壳：窗口里跑的就是 `../web` 的页面，功能都在网页里。只有 Mac 应用才需要的东西放这里：
原生菜单、Dock 角标和跳动、系统通知、窗口位置、单实例、关窗不退出、外链用默认浏览器打开。

一个功能网页上也该有的，写在 `web/`，不要在这里另写一份。

## 文件

- `main.js` — 主进程（CommonJS）：`app://happy/` 协议、窗口、菜单、Dock 角标、通知、页面能用的 IPC
- `preload.js` — 页面能调用的**全部**接口，挂在 `window.happyDesktop` 上
- `../web/desktop.js` — 页面这一侧：算角标数、决定什么时候发通知，网页和 Mac 应用共用，测试在 `../web/test/desktop.test.mjs`
- `smoke.js` — 冒烟测试
- `build.mjs` — 打包（ES module）
- `assets/` — 应用图标

## 安全边界

- 页面用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 运行，拿不到 Node。
  页面能让应用做的事只有 `preload.js` 暴露的那几个函数，不要往里加通用的通道（比如任意 IPC、任意 shell 命令）。
- `app://happy/` 只提供网页根目录里的文件：解码后的 `..`、编码过的斜杠、`main.js` 这类壳文件都要拒绝（`smoke.js` 有检查）。
- 窗口只加载 `app://happy/`。页面里的 `http(s)` / `mailto` 链接和新窗口交给 `shell.openExternal`，在默认浏览器里打开；
  聊天图片在单独的小窗口里打开，同样是 sandbox。
- 页面发的请求不带凭据，所以 `relaxCors` 只给没有 CORS 头的响应补 `Access-Control-Allow-Origin: *`，别扩大到别的头。

## 加一个桥接接口

页面要用一个新的 Mac 能力时，要改这几处，缺一处就不通：

1. `preload.js`：在 `happyDesktop` 上加函数，参数在这里就收窄成需要的类型
2. `main.js`：在 `bridge()` 里加 `ipcMain.on('desktop:<名字>', …)`，校验参数
3. `../web/desktop.js`（或用到它的模块）：先判断 `globalThis.window?.happyDesktop?.<函数>` 存在再调，浏览器里没有它
4. `smoke.js`：加一条检查，确认页面调用后主进程真的收到了

## 打包

- `npm run build` 打 arm64 和 x64（`-- --arch=arm64` 只打一个）。macOS 和 Linux 都能打：Mac 上用 `codesign`，
  Linux 上用 `rcodesign` 做 ad-hoc 签名。CI 在 Linux 上打。
- 打包时只复制页面实际用到的文件：从 `index.html` 出发，顺着 `<script src>` / `<link href>` / `<img src>`、
  ES `import` 和 CSS `url()` 找（`pageFiles()`）。所以网页里引用文件只能写静态的相对路径，动态拼出来的会漏掉。
- 打包时写 `build-info.json`（版本号、提交号、有没有未提交的改动），设置 › 关于 里显示。
- `npm run check` 检查 `dist/` 里的包是不是当前网页的构建，落后时退出码 1。
- `build/`、`dist/`、`smoke-out/` 不进 git。

## 验证

- `npm start`：直接用 `../web` 的文件跑应用，改了网页刷新窗口（⌘R）就能看到。
- `npm run smoke`：冒烟测试，检查页面加载、协议不越界、桥接接口、角标、通知、菜单。截图在 `smoke-out/`。
  其中「扫码登录能连到服务器」需要能访问 Happy 服务器。Linux 上：`xvfb-run -a npx electron --no-sandbox smoke.js`。
- 改了 `main.js` / `preload.js` 之后，至少跑一遍 `npm run smoke`，再手动试一下改到的功能（菜单、通知、角标）。

## 发版

只能通过开 PR 改 `package.json` 的 `version` 来发（`package-lock.json` 里的两处一起改），CI 打包发布，详见 [../AGENTS.md](../AGENTS.md)。
不要手动 `gh release create`，也不要把本地 `dist/` 里的包传上去。下载页的说明在 `../.github/release-notes.md`，
加了值得一提的功能时可以顺手更新。
