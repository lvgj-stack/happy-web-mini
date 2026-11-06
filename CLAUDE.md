# CLAUDE.md

## Worktrees

- Any development work (code, config, tests) happens in its own git worktree, never directly in the main checkout. Several sessions work in this repo at once; sharing one working tree and index lets one session's `git commit` sweep up another's staged changes.
  - Create: `git worktree add .dev/worktree/<name> -b <name> main` (`.dev/` is gitignored)
  - Dependencies are not shared: run `npm install` in the worktree's `web/` or `desktop/` (or symlink the main checkout's `node_modules`)
  - Work, verify and commit on that branch inside the worktree
  - Finish: rebase onto `main` in the worktree, then in the main checkout `git merge --ff-only <name>`; afterwards `git worktree remove .dev/worktree/<name>` and `git branch -d <name>`
- Never stage or commit other sessions' changes in the main checkout. If you must commit there, commit by path (`git commit -- <files>`) so only your files go in.

## Commits

- Commit every change once it is done and verified, and land it on `main` (via the worktree flow above). Don't leave work uncommitted.
- Every commit subject must have a scope: `<type>(<scope>): <summary>`
  - Scopes:
    - `web`: the web client (`web/`)
    - `desktop`: the macOS app (`desktop/`)
    - `all`: changes to both, or to the repo as a whole (`.gitignore`, `CLAUDE.md`, …)
  - Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`
  - Examples: `feat(web): 归档后自动打开相邻会话`, `fix(desktop): Dock 角标不清零`, `feat(all): 新增已归档分组并同步到 Mac 应用`
- Keep build output and dependencies (`node_modules/`, `desktop/build/`, `desktop/dist/`) out of git.

## Releases

The Mac app is released by CI (`.github/workflows/desktop-release.yml`), not by hand. Don't run `gh release create` yourself.

- The version comes only from `version` in `desktop/package.json`.
- To ship a new version, open a PR that bumps it (e.g. `1.0.0` → `1.0.1`). Every push to the PR builds and replaces the pre-release `v<version>-pr.<PR number>`, and the workflow comments the link on the PR. Closing the PR deletes that pre-release.
- When the PR lands on `main`, CI publishes `v<version>` as the latest release. Pushes to `main` whose version is already released (no bump) don't publish anything.
