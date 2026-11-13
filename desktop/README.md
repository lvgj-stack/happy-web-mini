# Happy for macOS

把 [`../web`](../web/README.md) 的 happy-web-mini 做成一个 Mac 应用（Electron）。功能和网页版完全一样，
另外有 Mac 应用该有的菜单、Dock 角标和系统通知。

开发规范见 [AGENTS.md](AGENTS.md)。

## 安装

1. 从 [GitHub Releases](https://github.com/lvgj-stack/happy-web-mini/releases) 下载：
   Apple 芯片（M 系列）选 `Happy-<版本>-mac-arm64.zip`，Intel 选 `Happy-<版本>-mac-x64.zip`
2. 解压，把 Happy.app 拖进「应用程序」
3. 第一次打开会被系统拦下（应用是 ad-hoc 签名，没有经过 Apple 公证）：右键 › 打开，
   或者在「系统设置 › 隐私与安全性」里点「仍要打开」。也可以直接去掉隔离标记：

   ```sh
   xattr -dr com.apple.quarantine /Applications/Happy.app
   ```

4. 登录：和网页版一样扫码或粘贴备份密钥。数据存在 `~/Library/Application Support/Happy`，和浏览器里的网页版互不影响，要单独登录一次。

更新：下载新版本覆盖掉旧的 Happy.app 即可，登录状态和设置都还在。

## 比网页版多的

- **菜单**：Happy › 设置…（⌘,）、文件 › 新建会话…（⌘N）、显示 › 切换侧栏（⌘B），编辑菜单里的复制、粘贴、撤销都能用
- **Dock 角标**：完成未读的会话数加上等你处理的会话数
- **系统通知**：窗口不在前台时，有会话完成或者开始等你回答就发通知，点开直接进入那个会话；等你回答时 Dock 图标还会跳一下。
  和网页版共用 设置 › 通知 的开关，这里默认打开、不用授权；另外可以关掉「通知带提示音」。
  收不到通知时，用 帮助 › 发送测试通知 检查系统有没有放行
- **已读更准**：窗口不在前台时，新消息不算已读（网页版只看标签页是否可见）
- **窗口**：隐藏式标题栏，红绿灯在侧栏顶部，侧栏和标题区域可以拖动窗口；关窗口不退出（同步和通知照常），点 Dock 图标回来；
  记住窗口大小和位置；只能开一个
- **链接**：网页里的链接用默认浏览器打开，聊天里的图片在单独的小窗口里打开

## 版本

应用里的页面是打包那一刻的网页代码，网页更新后要等发新版本。当前版本和提交号在 Happy › 关于 Happy 和页面的 设置 › 关于 里。

新版本由 CI 发布：在 PR 里把 `package.json` 的 `version` 改大，合进 `main` 后自动发正式版（详见 [../AGENTS.md](../AGENTS.md) 的「发版」）。

## 开发

```sh
npm install
npm start            # 直接用 ../web 的网页文件运行，改了网页 ⌘R 刷新
npm run smoke        # 冒烟测试；Linux 上：xvfb-run -a npx electron --no-sandbox smoke.js
npm run build        # 打 arm64 和 x64 两个包到 dist/；只打一个：npm run build -- --arch=arm64
npm run check        # dist/ 里的包是不是当前网页的构建（落后时退出码 1）
```

`npm run build` 在 macOS 和 Linux 上都能跑：只复制页面实际用到的文件，用 `assets/` 里的图标生成 .icns，
用 @electron/packager 打包，Mac 上用 `codesign`、Linux 上用 [rcodesign](https://github.com/indygreg/apple-platform-rs) 做 ad-hoc 签名，
最后压成保留符号链接的 zip。

文件说明、安全边界和加桥接接口的步骤见 [AGENTS.md](AGENTS.md)。
