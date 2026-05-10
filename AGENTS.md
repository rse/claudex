
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

The compiled `claudex.js` is the published entry point (`bin.claudex`
in `package.json`); the POSIX-sh `claudex` script next to it is a thin
launcher that `exec node claudex.js "$@"`. A second tiny shell script
`claude` simply `exec claudex "$@"` (prepending `$CLAUDEX_BASEDIR` to
`$PATH` if set), so users can transparently substitute `claudex` for
`claude`.

## Architecture

The entire program is a single file, `claudex.ts`. Dispatch is driven
by `commander` in `main()`, which defines a small command surface.
`claudex` re-invokes itself extensively (tmux `bind-key` strings,
container `docker exec` strings, sub-action chaining). Self-invocation
uses `node claudex.js` directly via `selfPathJS = <basedir>/claudex.js`
plus `process.execPath`, not the POSIX-sh `claudex` launcher &mdash;
this avoids a shell layer and keeps argv handling consistent across
platforms.

