
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

- `npm start build` &mdash; runs the build procedure: `eslint` + `tsc`.
- `npm start clean` &mdash; remove generated `claudex.js` and `tsc.tsbuildinfo`.
- `npm start clean-dist` &mdash; also remove `node_modules` and `package-lock.json`.

There are no tests in this repository.

The compiled `claudex.js` is the published entry point (`bin.claudex` in `package.json`); the
POSIX-sh `claudex` script next to it is a thin launcher that `exec node claudex.js "$@"`.
A second tiny shell script `claude` simply `exec claudex "$@"` (prepending `$CLAUDEX_BASEDIR`
to `$PATH` if set), so users can transparently substitute `claudex` for `claude`.

## Architecture

The entire program is a single file, `claudex.ts`. Dispatch is driven by `commander` in
`main()`, which defines a small command surface:

### Top-level invocation (default action: run Claude Code)

`claudex [-C] [-T [session]] [-R] [-A] [<claude-args>...]` &mdash; the default action runs
Claude Code, optionally wrapped by Capsula and/or tmux, optionally recolored, optionally
ASE-augmented. Top-level flags:

- `-C, --capsula` &mdash; run inside a per-user/per-session Capsula Docker container
  (`capsula-${USER}-debian-claude-${session}`).
- `-T, --tmux [session]` &mdash; wrap in a tmux session (auto-detected name, or explicit
  `[session]`). Session name is auto-detected by walking up to find `AGENTS.md` /
  `CLAUDE.md`; otherwise the cwd basename is used.
- `-R, --recolor` &mdash; pipe Claude Code through `ansi-recolor` using `ansi-recolor.conf`.
- `-A, --ase` &mdash; enable ASE statusline and auto-derive `ASE_TERM_WIDTH` /
  `ASE_TERM_COLORS` from the TTY for ASE diagram rendering.

Top-level `-h/--help` is intercepted before commander, passed through to `claude --help`,
and then the claudeX extension flags are appended to the help output.

In the default action the `claude` invocation:

- Prepends `$HOME/.local/bin` to `$PATH` (where `claude` is installed by the official installer).
- Injects a generated `--settings` JSON (telemetry/auto-update/bug/error-reporting disabled,
  spinner verbs replaced; with `-A` adds an `ase statusline` command; with `-T` enables
  experimental agent teams + `teammateMode: tmux` + `tmuxSplitPanes`).
- If `CLAUDE_MODEL=ollama:[//host[:port]]/<model>[?context=,capabilities=]` is set, rewrites
  `ANTHROPIC_*` env vars (base URL, auth token "ollama", default Haiku/Opus/Sonnet model,
  capabilities, auto-compact window) to point at a local Ollama server.

### Subcommands

- `install` &mdash; install host-side deps (tmux, lazygit, git, node, ansi-recolor,
  typescript-language-server, claude) via the platform's package manager (winget/choco on
  Windows, MacPorts/Homebrew on macOS, apt/apk on Linux), OR the in-container deps when
  `-C` is passed (Debian apt + Node.js + claude installer + the `claude` wrapper into
  `/usr/bin/claude`).
- `update` &mdash; update those same components.
- `internal <util> [args...]` &mdash; internal sub-dispatch, used by re-entrant
  self-invocation (tmux bind-keys, container `docker exec` strings, etc.). Utilities:
  - `internal tmux <tmux-args>` &mdash; spawn `tmux -f <generated-conf>` using `tmux.conf`
    with `@CLAUDEX@` substituted to `node /path/to/claudex.js` and `@CLAUDEX_FLAGS_PASSTHROUGH@`
    substituted to the propagated pass-through flags. Bind-keys: `c`/`|`/`-` (new claude
    pane), `g` (lazygit popup), `b` (bash/shell popup), `q` (ASE task-edit popup).
  - `internal shell [args...]` &mdash; spawn an interactive login shell
    (`$SHELL -l ...` on POSIX; PowerShell or `$ComSpec` on Windows).
  - `internal ase-task-edit` &mdash; read `#{@ase_task_id}` from the current tmux pane and
    run `ase task edit <tid>`.
  - `internal lazygit [args...]` &mdash; spawn `lazygit -ucf lazygit.yaml`, optionally
    wrapped by `ansi-recolor` when `-R` is in effect.
  - `internal capsula [args...]` &mdash; spawn `capsula -c claude -t debian -P linux/arm64`
    with the curated env-var allowlist (`TERM`, `HOME`, `CLAUDE_MODEL`, `CLAUDEX`),
    dotfile mount list (`.bashrc`, `.gitconfig`, `.ssh/*`, `.vimrc`, `.tmux.conf`,
    `.claude*`, `.dotfiles/*`, etc.), `.env`-file null-mounts (walked up from cwd), and
    `-b basedir`.

### Self-invocation

`claudex` re-invokes itself extensively (tmux `bind-key` strings, container `docker exec`
strings, sub-action chaining). Self-invocation uses `node claudex.js` directly via
`selfPathJS = <basedir>/claudex.js` plus `process.execPath`, not the POSIX-sh `claudex`
launcher &mdash; this avoids a shell layer and keeps argv handling consistent across
platforms. Inside tmux bind-key strings the same `node /path/to/claudex.js` form is
substituted into `tmux.conf` via the `@CLAUDEX@` placeholder.

### Flag propagation

The pass-through flags `-R` and `-A` are propagated to spawned tmux panes via the
`CLAUDEX_FLAGS_PASSTHROUGH` env var so new claude panes inherit the user's choice.
`-C` and `-T` are deliberately NOT propagated (they are consumed at the outer layer to
avoid recursive container/tmux nesting).

The `CLAUDEX_FLAGS` env var lets users set default top-level flags (`-R`/`-C`/`-T`/`-A`);
they are merged with command-line flags (env first, command-line second; already-present
flags are not duplicated). This merge is skipped for the `internal` sub-dispatch.

### Sandbox detection

Inside the Capsula container, `ENVIRONMENT=capsula` is set; commands that must not run
in-container (`install`/`update` non-capsula path, the default action with `-C` or `-T`,
and `internal capsula`) check this and `fatal()` early.

### Claude Code version pruning

After a successful install/update, `pruneClaudeVersions()` removes all but the currently
active version under `~/.local/share/claude/versions` (active version is detected by
running the installed `claude --version`).
