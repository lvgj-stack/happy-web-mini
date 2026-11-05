# CLAUDE.md

## Commits

- Commit every change on `main` once it is done and verified. Don't leave work uncommitted.
- Every commit subject must have a scope: `<type>(<scope>): <summary>`
  - Scopes:
    - `web`: the web client (`web/`)
    - `desktop`: the macOS app (`desktop/`)
    - `all`: changes to both, or to the repo as a whole (`.gitignore`, `CLAUDE.md`, …)
  - Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`
  - Examples: `feat(web): 归档后自动打开相邻会话`, `fix(desktop): Dock 角标不清零`, `feat(all): 新增已归档分组并同步到 Mac 应用`
- Keep build output and dependencies (`node_modules/`, `desktop/build/`, `desktop/dist/`) out of git.
