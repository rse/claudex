
ChangeLog
=========

0.9.21 (2026-05-09)
-------------------

- IMPROVEMENT: support CLAUDEX\_FLAGS env variable for passing default options

0.9.20 (2026-05-09)
-------------------

- BUGFIX: try to workaround problems again in self-reference under Windows

0.9.19 (2026-05-09)
-------------------

- BUGFIX: try to workaround problems again in self-reference under Windows

0.9.18 (2026-05-09)
-------------------

- BUGFIX: try to workaround problems again in self-reference under Windows

0.9.18 (2026-05-09)
-------------------

- BUGFIX: try to workaround problems in self-reference under Windows

0.9.17 (2026-05-09)
-------------------

- BUGFIX: fix tool finding under Windows

0.9.16 (2026-05-09)
-------------------

- CLEANUP: cleanup descriptions

0.9.15 (2026-05-09)
-------------------

- FEATURE: add `-A`/`--ase` global option to make ASE features conditional
- FEATURE: add `CHANGELOG.md` file
- IMPROVEMENT: apply ANSI recoloring to `lazygit` only when global `-R` option is given
- IMPROVEMENT: apply tmux-specific settings only under option `-T`
- IMPROVEMENT: take over more useful settings from dotfiles
- IMPROVEMENT: improve portability across platforms
- UPDATE: switch license to GPL
- CLEANUP: various code cleanups

0.9.14 (2026-05-09)
-------------------

- IMPROVEMENT: allow `-T <session>` to name the session
- CLEANUP: cleanup after refactoring
- CLEANUP: ignore generated file

0.9.13 (2026-05-09)
-------------------

- REFACTOR: major refactoring by using commander.js to make `claudex` a seamless wrapper around `claude` only
- IMPROVEMENT: switch to `CTRL+a s` for starting the shell and support PowerShell, too
- IMPROVEMENT: support `SHELL` env variable
- IMPROVEMENT: support `CLAUDEX_PKG` for forcing a particular package manager
- IMPROVEMENT: improve the `exec` simulation
- IMPROVEMENT: multiple improvements to install
- IMPROVEMENT: tell the agent the right commands
- IMPROVEMENT: be more robust on the execution
- IMPROVEMENT: move the key-binding to config file
- BUGFIX: fail fast for empty Ollama model
- BUGFIX: fix pruning of old versions
- BUGFIX: fallback value for session
- CLEANUP: remove obsolete information
- CLEANUP: escape strings on interpolation

0.9.12 (2026-05-08)
-------------------

- FEATURE: add an AGENTS.md file
- IMPROVEMENT: be more portable by using `which` and `chalk` packages
- IMPROVEMENT: make more portable towards Windows support
- IMPROVEMENT: improve portability across all platforms
- IMPROVEMENT: provide also update command
- IMPROVEMENT: make some commands optional
- IMPROVEMENT: vertical alignment of imports
- IMPROVEMENT: do not skip top-level header
- IMPROVEMENT: sort variables
- IMPROVEMENT: use camel-case
- IMPROVEMENT: use helper function to reduce redundancy
- BUGFIX: fix typography
- BUGFIX: fix URL
- UPDATE: upgrade dependencies
- UPDATE: add `stx` and `eslint` infrastructure
- CLEANUP: remove old debugging aids
- CLEANUP: cleanup package description
- CLEANUP: cleanup README
- CLEANUP: various code cleanups
- CLEANUP: make ESLint happy
- CLEANUP: ignore `.ase` directory
- CLEANUP: add ignore files
- CLEANUP: remove generated file from VCS
- CLEANUP: remove `ccusage`
- CLEANUP: remove SC for now as it makes too much trouble for others as a dependency
- CLEANUP: remove SC references
- CLEANUP: move screenshots into `doc` folder
- CLEANUP: remove LF tool for now to make claudeX more portable
- CLEANUP: remove RSE reference

0.9.11 (2026-05-04)
-------------------

- IMPROVEMENT: use new coloring functionality

0.9.10 (2026-05-04)
-------------------

- IMPROVEMENT: switch to new functionality

0.9.9 (2026-05-03)
------------------

- IMPROVEMENT: switch to new `ase statusline` (where we factored out the code into)

0.9.8 (2026-05-03)
------------------

- FEATURE: add support for editing the current ASE task plan
- IMPROVEMENT: improve statuslines

0.9.7 (2026-05-03)
------------------

- FEATURE: support ASE persona
- IMPROVEMENT: adapt to recent ASE changes

0.9.6 (2026-05-02)
------------------

- IMPROVEMENT: invert the `-h`/host option to `-s`/sandbox

0.9.5 (2026-05-01)
------------------

- FEATURE: support `ase diagram` clipping
- IMPROVEMENT: support ASE color mode in `ase diagram` rendering
- IMPROVEMENT: allow hyperlinks

0.9.4 (2026-04-30)
------------------

- IMPROVEMENT: embed code of statusline into claudeX
- CLEANUP: remove `VERSION.txt` and use `package.json` now

0.9.3 (2026-04-30)
------------------

- REFACTOR: migrate from Bash to Node/TypeScript
- BUGFIX: fix version

0.9.2 (2026-04-27)
------------------

- IMPROVEMENT: improve status bar
- IMPROVEMENT: improve status line
- IMPROVEMENT: support narrow terminals (especially in tmux panes)
- IMPROVEMENT: sync with official `tmux.conf` from my dotfiles project

0.9.1 (2026-04-18)
------------------

- IMPROVEMENT: more colors for Claude Code
- CLEANUP: cleanup status lines

0.9.0 (2026-04-16)
------------------

- FEATURE: add support for Ollama models (like Qwen or Gemma)
- FEATURE: try to better support agent teams
- IMPROVEMENT: allow `-h` (host) option more consistently
- IMPROVEMENT: improve install/update commands
- IMPROVEMENT: recolor also LazyGit and LF
- IMPROVEMENT: support update and install locally, too
- IMPROVEMENT: allow mouse to be toggled and change key for window mute
- IMPROVEMENT: add more tools
- IMPROVEMENT: synchronize with my dotfiles project
- IMPROVEMENT: add screenshots
- IMPROVEMENT: improve styling
- IMPROVEMENT: add a "see also" section
- IMPROVEMENT: use small "c" for the name
- BUGFIX: fix colors
- BUGFIX: try to fix colors
- BUGFIX: fix one more color
- BUGFIX: fix color of plan
- UPDATE: add version
- CLEANUP: cleanup naming
- CLEANUP: cleanup config
- CLEANUP: reduce verbose outputs
- CLEANUP: remove trailing blank
- CLEANUP: initially place under version control

