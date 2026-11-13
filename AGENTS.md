# AGENTS.md

这个仓库的开发规范，给在这里写代码的 agent（Claude Code、Codex、Cursor……）和人看。
`web/` 和 `desktop/` 各有自己的 `AGENTS.md`，改哪个目录先读哪个。

## 仓库是什么

最小的 [Happy](https://happy.engineering) 客户端，直连官方 server，两部分：

- `web/` — 网页客户端。无构建步骤，原生 ES module，`index.html` + 一组 `.js` 直接跑在浏览器里。规范见 [web/AGENTS.md](web/AGENTS.md)
- `desktop/` — 把 `web/` 原样打包成 macOS 应用（Electron），只加 Mac 才有的东西（菜单、Dock 角标、系统通知）。规范见 [desktop/AGENTS.md](desktop/AGENTS.md)

功能都写在 `web/` 里，Mac 应用自动跟着有，一般不需要两边各写一遍。

协议（消息格式、RPC、加密）以 Happy 仓库为准：`happy-cli`（CLI 发什么）、`happy-server`（接口和 seq）、`happy-ios` / `happy-android`（官方 App 怎么做）。对照着实现时，在代码注释里写明对照的是哪个文件或函数。

## Worktree

- 所有开发（代码、配置、测试、文档）都在自己的 git worktree 里做，不要直接在主 checkout 里改。这个仓库常有几个会话同时在干活，共用一个工作区和暂存区时，一个会话的 `git commit` 会把别人暂存的改动一起提交进去。
  - 创建：`git worktree add .dev/worktree/<name> -b <name> main`（`.dev/` 已被 gitignore）
  - 依赖不共享：在 worktree 的 `web/` 或 `desktop/` 里 `npm install`，或者软链主 checkout 的 `node_modules`（`ln -s ../../../../web/node_modules web/node_modules`，软链也被 gitignore 了）
  - 在 worktree 的分支上开发、验证、提交
  - 收尾：在 worktree 里 rebase 到最新的 `main`，再到主 checkout 里 `git merge --ff-only <name>`；然后 `git worktree remove .dev/worktree/<name>`、`git branch -d <name>`
- 不要在主 checkout 里暂存或提交别的会话的改动。万不得已要在主 checkout 提交时，按路径提交（`git commit -- <files>`），只带上自己的文件。
- 不要用裸的 `git stash` / `git stash pop`：stash 栈是所有 worktree 共用的，可能弹出别人的改动。要临时放一放就做一个 WIP 提交。

## 提交

- 改完、验证过就提交，并合进 `main`（走上面的 worktree 流程），不要留着没提交的改动。
- 提交标题必须带 scope：`<type>(<scope>): <summary>`，summary 用中文，说用户能看到的变化
  - scope：
    - `web`：网页客户端（`web/`）
    - `desktop`：Mac 应用（`desktop/`）
    - `all`：两边都改，或者改的是整个仓库（`.gitignore`、`AGENTS.md`、`CLAUDE.md`……）
  - type：`feat`、`fix`、`refactor`、`docs`、`style`、`test`、`chore`
  - 例子：`feat(web): 归档后自动打开相邻会话`、`fix(desktop): Dock 角标不清零`、`feat(all): 新增已归档分组并同步到 Mac 应用`
- 正文可选，写清楚为什么这样做、有什么取舍。
- 构建产物和依赖（`node_modules/`、`desktop/build/`、`desktop/dist/`、`web/build-info.json`）不进 git。

## 合进 main 和推送

- 合进 `main` 之后就推到 `origin`（`git push origin main`）。
- 远端的 `main` 经常有别的会话推的新提交。合并前先 `git fetch origin`，在 worktree 里 rebase 到 `origin/main`，解决冲突、重新跑测试，再快进合并、推送。别用 merge commit，也别 force push `main`。
- 推送失败多半是 GitHub 登录失效（`gh auth status` 能看出来），让人重新 `gh auth login`，不要绕过去。

## 发版

Mac 应用由 CI（`.github/workflows/desktop-release.yml`）发版，不要手动发，也不要自己跑 `gh release create`。

- 版本号只看 `desktop/package.json` 的 `version`（`desktop/package-lock.json` 里的两处跟着一起改）。
- 要发新版就开一个 PR 把版本号改大（例如 `1.0.0` → `1.0.1`）。PR 每推送一次，CI 就打一次包，发布或替换预发版 `v<version>-pr.<PR 号>`，并在 PR 里贴下载链接。PR 关闭后删掉这个预发版。
- PR 合进 `main` 后，CI 把 `v<version>` 发成正式版。往 `main` 推送时，如果这个版本已经发过（没改版本号），什么都不发。
- 下载页的说明来自 `.github/release-notes.md`。

## 文档

- 用户能感知的变化（新功能、行为变了、新的限制），更新对应目录 `README.md` 里的那一节。README 写给使用的人看：能做什么、怎么用、有什么限制。
- 实现上的约定和要点（协议字段、RPC、缓存键、为什么这样做），写进对应目录的 `AGENTS.md`。
- 规范变了（新的流程、新的约定），更新 `AGENTS.md`。`CLAUDE.md` 只是引用 `AGENTS.md`，不要往里写内容。
- 设计稿和实现计划放在 `docs/superpowers/specs/`、`docs/superpowers/plans/`，文件名带日期。
