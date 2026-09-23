# Potato Tomato 3 — agent notes

## Coordinating agents: agent-locks

This repo is set up for [agent-locks](https://github.com/luohoa97/agent-locks) (`.mcp.json`).
Locks are markdown files under `<git-common-dir>/agents-locks/`, so every worktree of this
repo sees the same set and none of them can ever be committed.

Any agent that edits files here, including a subagent in its own worktree:

1. `lock_query` to see who is working on what, then `lock_check_conflict` with the globs you
   are about to touch. Neither blocks you. If an active lock overlaps, keep off those files or
   coordinate through the agent that holds the lock.
2. `lock_create` with a title, the globs you will touch, and your task checklist.
3. `lock_update` as each task is finished, not in one batch at the end.
4. `lock_finish` with a one-line summary when the work is committed.

Scope globs are repo-relative (`src/lib/components/settings/**`). Keep them as narrow as the
work allows: a lock on `src/**` tells nobody anything.

## Verifying changes

- `pnpm check`, `pnpm lint`, `pnpm test` (vitest; the `client` project needs
  `npx playwright install chromium` first; `--project server` runs without it).
- `pnpm puller:test` for `puller/`, `pnpm bridge-test` for the in-frame storage/key bridge.
- `cargo check` in `src-tauri/` on Linux needs
  `PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig` when a linuxbrew
  `pkg-config` is first on `PATH`.
- `static/games/` holds ~13k catalog entries. Never run tools that walk it unbounded, and keep
  it out of watchers.
