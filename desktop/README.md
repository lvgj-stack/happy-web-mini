# Happy for macOS

把 `../web` 里的 happy-web-mini 做成一个 Mac 应用（Electron）。功能和网页版一样，另外加上 Mac 应用该有的这些：

- 原生菜单：Happy › 设置…（⌘,）、文件 › 新建会话…（⌘N）、显示 › 切换侧栏（⌘B），编辑菜单里的复制粘贴、撤销都能用
- Dock 角标：完成未读的会话数加上等你回答的会话数
- 系统通知：窗口不在前台时，有会话回复完成或者开始等你回答就发一条通知，点开直接进入那个会话；等你回答时 Dock 图标还会跳一下。
  和网页版共用 设置 › 通知 的开关，这里默认打开。下面还有「通知带提示音」（只在 Mac 应用里有，默认打开），关掉后通知静音弹出，
  测试通知也跟着它。帮助 › 发送测试通知 可以检查系统有没有放行
- 窗口不在前台时新消息不算已读（网页版只看标签页是否可见）
- 隐藏式标题栏：红绿灯在侧栏顶部，侧栏和标题区域可以拖动窗口
- 关窗口不退出（同步继续，通知照常），点 Dock 图标回来；窗口大小和位置会记住；只允许开一个实例
- 网页里的链接用默认浏览器打开，聊天图片在单独的小窗口里打开

## 安装

从 [GitHub Releases](https://github.com/lvgj-stack/happy-web-mini/releases) 下载 `Happy-<版本>-mac-arm64.zip`（Apple 芯片）或
`-x64.zip`（Intel），本地打包的在 `dist/` 里。解压后把 Happy.app 拖进「应用程序」。

## 发版

由 CI（`.github/workflows/desktop-release.yml`）发，版本号只看 `package.json` 的 `version`：

- PR 每次推送都会打包，发预发版 `v<版本>-pr.<PR 号>`，并在 PR 里贴下载链接；PR 关闭后自动删除
- 合进 `main` 时，如果 `v<版本>` 还没发过就发正式版。要发新版就在 PR 里把版本号改大

应用是 ad-hoc 签名，没有经过 Apple 公证。如果是浏览器下载的，第一次打开会被拦下：右键 › 打开，
或者在「系统设置 › 隐私与安全性」里点「仍要打开」。也可以直接去掉隔离标记：

```sh
xattr -dr com.apple.quarantine /Applications/Happy.app
```

数据（登录状态、设置、草稿）存在 `~/Library/Application Support/Happy`，和浏览器里的 web-mini 互不影响，需要单独登录一次。

## 开发

```sh
npm install
npm start            # 直接用 ../web 里的网页文件运行
npm run smoke        # 冒烟测试；Linux 上：xvfb-run -a npx electron --no-sandbox smoke.js
npm run build        # 打 arm64 和 x64；只打一个：npm run build -- --arch=arm64
npm run check        # dist/ 里的包是否就是当前网页的构建（落后时退出码 1）
```

应用里的页面是打包那一刻的网页代码，网页改了就要重新打包。关于 Happy 面板和页面的 设置 › 关于 里都显示打包时的 git 提交号（带「+改动」/「含未提交的改动」表示有未提交的改动）。

`npm run build` 在 macOS 和 Linux 上都能跑：只复制页面实际引用到的文件（从 index.html 顺着 link/script 和
ES import 找），用 `assets/` 里的 Happy 图标生成 .icns，用 @electron/packager 打包，在 Mac 上用 `codesign`、
在 Linux 上用 [rcodesign](https://github.com/indygreg/apple-platform-rs) 做 ad-hoc 签名，最后压成保留符号链接的 zip。

## 文件

- `main.js` — 主进程：`app://happy/` 协议（只提供网页根目录里的文件）、窗口、菜单、Dock 角标和通知
- `preload.js` — 页面能调用的全部接口（`window.happyDesktop`）
- `../web/desktop.js` — 页面这一侧：算角标、决定什么时候发通知（测试在 `../web/test/`）
- `smoke.js` — 冒烟测试：页面加载无报错、扫码登录能连到服务器、协议不越界、角标/通知/菜单都通
- `build.mjs` — 打包
