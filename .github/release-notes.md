Happy web-mini 的 macOS 应用（Electron）。

## 下载

- **Apple 芯片（M 系列）**：`Happy-{{VERSION}}-mac-arm64.zip`
- **Intel**：`Happy-{{VERSION}}-mac-x64.zip`

解压后把 Happy.app 拖进「应用程序」。

## 首次打开

应用是 ad-hoc 签名，没有经过 Apple 公证，浏览器下载后第一次打开会被拦下：右键 › 打开，或者在「系统设置 › 隐私与安全性」里点「仍要打开」。也可以直接去掉隔离标记：

```sh
xattr -dr com.apple.quarantine /Applications/Happy.app
```

数据存在 `~/Library/Application Support/Happy`，和浏览器里的 web-mini 互不影响，需要单独登录一次。

## 功能

和网页版一样，另外有原生菜单（⌘, 设置、⌘N 新建会话、⌘B 切换侧栏）、Dock 角标、系统通知、隐藏式标题栏、关窗口不退出、记住窗口位置。详见 [desktop/README.md](https://github.com/lvgj-stack/happy-web-mini/blob/main/desktop/README.md)。
