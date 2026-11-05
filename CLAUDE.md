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

## Releases

The Mac app is released by CI (`.github/workflows/desktop-release.yml`), not by hand. Don't run `gh release create` yourself.

- The version comes only from `version` in `desktop/package.json`.
- To ship a new version, open a PR that bumps it (e.g. `1.0.0` → `1.0.1`). Every push to the PR builds and replaces the pre-release `v<version>-pr.<PR number>`, and the workflow comments the link on the PR. Closing the PR deletes that pre-release.
- When the PR lands on `main`, CI publishes `v<version>` as the latest release. Pushes to `main` whose version is already released (no bump) don't publish anything.
