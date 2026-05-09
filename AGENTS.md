
# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Project

**claudeX** (aka `@rse/claudex`) is an opinionated wrapper around Claude
Code (the `claude` CLI) for macOS, Linux, and Windows. It bundles
theming (via `ansi-recolor`), terminal multiplexing (via `tmux`),
optional sandboxed execution (via `capsula` Docker containers), and
modal companion tools (LazyGit, Bash) into a single `claudex` command.

## Build / Lint

The project is written in TypeScript and built via the `stx` task runner (config in `stx.conf`).

- `npm start build` &mdash; runs the build procedcure: `eslint` + `tsc`.
- `npm start clean` &mdash; remove generated `claudex.js` and `tsc.tsbuildinfo`.
- `npm start clean-dist` &mdash; also remove `node_modules` and `package-lock.json`.

There are no tests in this repository.

The compiled `claudex.js` is the published entry point (`bin.claudex` in `package.json`); the
POSIX-sh `claudex` script next to it is a thin launcher that `exec node claudex.js "$@"`.
A second tiny shell script `claude` re-routes `claude session ...` &rarr; `claudex session ...` and
everything else &rarr; `claudex naked ...`.

## Architecture

The entire program is a single file, `claudex.ts`, dispatched as a `switch (cmd)` in `main()`.
Subcommands:

- `version` &mdash; print version from `package.json`.
- `install` &mdash; install host-side deps (tmux, lazygit, git, node, ansi-recolor,
  typescript-language-server, claude) via the platform's package manager, OR install
  the in-container deps (when run inside a Capsula sandbox, detected via `ENVIRONMENT=capsula`).
- `update` &mdash; update those same components.
- `session` &mdash; main entry point: launch (or reattach to) a tmux session named after the
  current project (auto-detected by walking up to find `AGENTS.md` / `CLAUDE.md`), running
  `claudex claude` inside it. With `-s`, runs inside a per-user/per-session Capsula Docker
  container (`capsula-${USER}-debian-claude-${session}`).
- `naked` &mdash; like `session` but without tmux: just `claudex claude` (optionally inside Capsula).
- `shell` &mdash; spawn `capsula` with the curated env-var allowlist, dotfile mount list,
  `-b basedir`, and arbitrary trailing args. Used internally to enter the container.
- `claude` &mdash; the actual `claude` invocation. Wraps `claude` with `ansi-recolor` for theming;
  injects `claude-settings.json` (with `@BASEDIR@` substituted) via `--settings`; if
  `CLAUDE_MODEL=ollama:[//host]/model[?context=,capabilities=]` is set, rewrites
  `ANTHROPIC_*` env vars to point at a local Ollama server; auto-derives `ASE_TERM_WIDTH`
  / `ASE_TERM_COLORS` from the TTY for ASE diagram rendering.
- `util tmux|bash|lazygit|ase-task-edit` &mdash; helpers invoked from inside tmux. The `tmux`
  util applies `tmux.conf` plus runtime `bind-key` definitions for `c`/`|`/`-` (new claude
  pane), `g` (lazygit popup), `b` (bash popup), `q` (ASE task-edit popup).

### Self-invocation

`claudex` re-invokes itself extensively (e.g. tmux `bind-key` strings, container `docker exec`
strings). For this it uses `selfPath = <basedir>/claudex` (the POSIX-sh launcher) rather than
the `.js` directly, because shell strings need a runnable command. Inside the function `self()`
the `.js` is invoked directly via `node`. Keep this distinction in mind when adding new
self-invocations.

### Sandbox detection

The `-s` flag (consumed before `cmd`) sets `sandbox=true`, which switches `install`/`session`/
`naked` into Capsula mode. Inside the container, `ENVIRONMENT=capsula` is set; commands that
must not run in-container (`install` non-sandbox path, `session`, `naked`, `shell`) check this
and `fatal()` early.

