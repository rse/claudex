#!/usr/bin/env node
/*!
**  claudeX -- Claude Code eXtended
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under GPL 3.0 <https://spdx.org/licenses/GPL-3.0-only>
*/

import * as fs              from "node:fs"
import * as path            from "node:path"
import * as os              from "node:os"
import { execa, execaSync } from "execa"
import which                from "which"
import chalk                from "chalk"
import deepmerge            from "deepmerge"
import { Command }          from "commander"
import * as shQ             from "shell-quote"

/*  type for environment variable map  */
type Env = Record<string, string | undefined>

/*  determine our base directory (handle absolute, relative, PATH, symlinks)  */
const findBaseDir = (): string => {
    const argv1 = process.argv[1] ?? ""
    let resolved = argv1
    try {
        resolved = fs.realpathSync(argv1)
    }
    catch (_e) {
        /*  ignore  */
    }
    return path.dirname(resolved)
}
const basedir = findBaseDir()

/*  the path used for self-invocation  */
const selfPathJS = path.join(basedir, "claudex.js")

/*  helper for displaying info messages  */
const info = (msg: string): void => {
    process.stderr.write(`${chalk.blue("claudex: ")}${chalk.blue.bold("INFO:")}${chalk.blue(` ${msg}`)}\n`)
}

/*  helper for raising a fatal error  */
const fatal = (msg: string): never => {
    process.stderr.write(`${chalk.red("claudex: ")}${chalk.red.bold("ERROR:")}${chalk.red(` ${msg}`)}\n`)
    process.exit(1)
}

/*  helper to locate a tool in $PATH (cross-platform).
    On Windows, `which.sync` can fail to find App Execution Aliases
    (zero-byte reparse-point stubs under %LOCALAPPDATA%\Microsoft\WindowsApps,
    e.g. winget.exe, python.exe), because the `stat()` check inside the
    `which` package may not classify them as regular files. As a fallback
    we therefore also consult the native `where` command on Windows.  */
const findTool = (tool: string): string | null => {
    const r = which.sync(tool, { nothrow: true })
    if (r !== null)
        return r
    if (process.platform === "win32") {
        const r2 = execaSync("where", [ tool ], { reject: false, windowsHide: true })
        if ((r2.exitCode ?? 1) === 0) {
            const line = (r2.stdout ?? "").toString().split(/\r?\n/)[0].trim()
            if (line !== "")
                return line
        }
    }
    return null
}

/*  helper to detect whether the active `tmux` is actually `psmux`
    (the Windows port). psmux does not identify itself via `tmux -V`,
    so we instead check whether we are on Windows AND a `psmux` command
    is available in $PATH. The result is cached after the first call.  */
let isPsmuxCached: boolean | null = null
const isPsmux = (): boolean => {
    if (isPsmuxCached !== null)
        return isPsmuxCached
    isPsmuxCached = process.platform === "win32" && findTool("psmux") !== null
    return isPsmuxCached
}

/*  helper for detecting the platform and package manager combination  */
const detectPlatform = (): string => {
    /*  helper function for finding a tool in PATH  */
    const has = (tool: string): boolean =>
        findTool(tool) !== null

    /*  honor explicit override via CLAUDEX_PKG (e.g. "brew", "ports", "apt", ...)
        to disambiguate hosts where multiple package managers are installed  */
    const override = process.env.CLAUDEX_PKG ?? ""
    if (override !== "") {
        const pm: Record<string, { plat: string, tool: string, key: string }> = {
            winget: { plat: "win32",  tool: "winget", key: "windows:winget" },
            choco:  { plat: "win32",  tool: "choco",  key: "windows:choco"  },
            ports:  { plat: "darwin", tool: "port",   key: "macos:ports"    },
            brew:   { plat: "darwin", tool: "brew",   key: "macos:brew"     },
            apt:    { plat: "linux",  tool: "apt",    key: "linux:apt"      },
            apk:    { plat: "linux",  tool: "apk",    key: "linux:apk"      }
        }
        const entry = pm[override]
        if (entry === undefined)
            return fatal(`unknown CLAUDEX_PKG value "${override}" ` +
                `(allowed: ${Object.keys(pm).join(", ")})`)
        if (process.platform !== entry.plat)
            return fatal(`CLAUDEX_PKG="${override}" is not valid on platform "${process.platform}"`)
        if (!has(entry.tool))
            return fatal(`CLAUDEX_PKG="${override}" requested but tool "${entry.tool}" not found in $PATH`)
        return entry.key
    }
    if (process.platform === "win32" && has("winget"))
        return "windows:winget"
    else if (process.platform === "win32" && has("choco"))
        return "windows:choco"
    else if (process.platform === "darwin" && has("port"))
        return "macos:ports"
    else if (process.platform === "darwin" && has("brew"))
        return "macos:brew"
    else if (process.platform === "linux" && has("apt"))
        return "linux:apt"
    else if (process.platform === "linux" && has("apk"))
        return "linux:apk"
    else
        return fatal(`unsupported platform "${process.platform}" or no known package manager found`)
}

/*  helper to spawn a child synchronously inheriting stdio, then exit
    with its code (the closest equivalent of Bash "exec ...")  */
const execInherit = (file: string, args: string[], opts: { env?: Env } = {}): never => {
    const r = execaSync(file, args, {
        stdio:        "inherit",
        env:          opts.env,
        reject:       false,
        windowsHide:  false
    })
    process.exit(r.exitCode ?? 0)
}

/*  helper to execute a platform-specific command  */
const executeCommand = (config: { [ platform: string ]: string[] | string }) => {
    const platform = detectPlatform()
    const osName = platform.split(":")[0]
    const command = config[platform] ?? config[`${osName}:*`]
    if (command === undefined)
        fatal(`no command configured for platform "${platform}"`)
    const cmd = command instanceof Array ? command : command.split(/\s+/)
    info(`execute: $ ${cmd.join(" ")}`)
    const result = execaSync(cmd[0], cmd.slice(1), {
        stdio:        "inherit",
        env:          process.env,
        reject:       false,
        windowsHide:  false
    })
    return result.exitCode
}

/*  helper to ensure a tool is available  */
const ensureTool = (tool: string | string[], options: {
    install?:  { [ platform: string ]: string[] | string },
    hint?:     string,
    optional?: boolean
} = {}): void => {
    const tools = typeof tool === "string" ? [ tool ] : tool
    for (const tool of tools) {
        let r = findTool(tool)
        if (r === null && options.install) {
            const rc = executeCommand(options.install)
            if (rc !== 0) {
                if (options.optional)
                    continue
                fatal(`failed to install required tool "${tool}" (exit ${rc})` +
                    (options.hint !== undefined ? ` -- hint: ${options.hint}` : ""))
            }
            r = findTool(tool)
        }
        if (r !== null)
            continue
        if (options.optional)
            continue
        if (options.hint !== undefined)
            fatal(`required tool "${tool}" not found in $PATH -- hint: ${options.hint}`)
        else
            fatal(`required tool "${tool}" not found in $PATH`)
    }
}

/*  re-invoke this same script (mirrors "$0 ..." in Bash)  */
const self = async (...args: string[]): Promise<number> => {
    const r = await execa(process.execPath, [ selfPathJS, ...args ], {
        stdio:  "inherit",
        reject: false
    })
    if ((r.exitCode ?? 0) !== 0)
        process.exit(r.exitCode ?? 1)
    return r.exitCode ?? 0
}

/*  detect the session/project name by walking up from the current working
    directory looking for an AGENTS.md / CLAUDE.md marker; fall back to the
    basename of the current working directory  */
const detectSessionName = (): string => {
    let dir = process.cwd()
    while (true) {
        if (fs.existsSync(path.join(dir, "AGENTS.md")) || fs.existsSync(path.join(dir, "CLAUDE.md")))
            return path.basename(dir)
        const parent = path.dirname(dir)
        if (parent === dir)
            break
        dir = parent
    }
    const session = path.basename(process.cwd()) || "default"
    info(`no AGENTS.md/CLAUDE.md marker found; using cwd basename "${session}" as session name`)
    return session
}

/*  determine information  */
const HOME        = process.env.HOME ?? os.homedir()
const detectUser = (): string => {
    if (process.env.USER)
        return process.env.USER
    if (process.env.LOGNAME)
        return process.env.LOGNAME
    if (process.env.USERNAME)
        return process.env.USERNAME
    try {
        return os.userInfo().username
    }
    catch (_e) {
        return ""
    }
}
const USER        = detectUser()
const TERM        = process.env.TERM ?? ""
const ENVIRONMENT = process.env.ENVIRONMENT ?? ""

/*  helper: prune all but the given active Claude Code version  */
const pruneClaudeVersions = (active: string | null): void => {
    if (active === null)
        return
    const versionsDir = path.join(HOME, ".local/share/claude/versions")
    if (!fs.existsSync(versionsDir))
        return
    for (const f of fs.readdirSync(versionsDir)) {
        if (f === active)
            continue
        try {
            fs.rmSync(path.join(versionsDir, f), { recursive: true, force: true })
        }
        catch (_e) {
        }
    }
}

/*  helper: detect the active Claude Code version via the installed binary  */
const detectActiveClaudeVersion = (binName: string): string | null => {
    try {
        const r = execaSync(path.join(HOME, ".local/bin", binName), [ "--version" ], { reject: false })
        const m = /^(\S+)/.exec(r.stdout ?? "")
        if (m)
            return m[1]
    }
    catch (_e) {
        /*  binary missing or not executable  */
    }
    return null
}

/*  options for the top-level command  */
type TopOpts = {
    ase?:     boolean,
    capsula?: boolean,
    recolor?: boolean,
    tmux?:    boolean | string
}

/*  action: install host-side or in-container dependencies  */
const actionInstall = async (capsula: boolean): Promise<void> => {
    /*  sanity check environment  */
    if (ENVIRONMENT === "capsula")
        fatal("cannot execute \"install\" command from within Capsula environment")

    /*  ensure we are not running from the home directory
        in order to not read-write mount its ~/.local/!  */
    try {
        process.chdir(basedir)
    }
    catch (_e) {
        fatal("cannot switch to base directory")
    }

    /*  dispatch according to host/container mode  */
    if (capsula) {
        info("update Debian GNU/Linux operating system")
        await self("internal", "capsula", "sudo", "-E", "apt", "update", "-qq")
        await self("internal", "capsula", "sudo", "-E", "apt", "upgrade", "-qq", "-y")

        info("install Tmux / LazyGit / Git")
        await self("internal", "capsula", "sudo", "-E", "apt", "install", "-qq", "-y", "tmux", "lazygit", "git")

        info("install Node.js")
        await self("internal", "capsula", "sudo", "-E", "bash", "-c", "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -")
        await self("internal", "capsula", "sudo", "-E", "apt", "install", "-qq", "-y", "nodejs")
        await self("internal", "capsula", "sudo", "-E", "apt", "install", "-qq", "-y", "binutils", "gcc", "g++", "make")

        info("install Claude Code")
        await self("internal", "capsula", "bash", "-c", `PATH="${HOME}/.local/bin:$PATH"; curl -kfsSL https://claude.ai/install.sh | bash`)

        info("install ANSI-Recolor")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "ansi-recolor")

        info("install TypeScript LS")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "typescript-language-server")

        info("install CodeBurn")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "codeburn")

        info("install ASE")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "@rse/ase")

        info("install Claude wrapper")
        await self("internal", "capsula", "sudo", "install", "-c", "-m", "755", `${basedir}/claude`, "/usr/bin/claude")

        /*  prune obsolete versions only after successful install  */
        await self("internal", "capsula", "bash", "-c",
            "VERSIONS=\"$HOME/.local/share/claude/versions\"; " +
            "[ -d \"$VERSIONS\" ] || exit 0; " +
            "ACTIVE=$(\"$HOME/.local/bin/claude\" --version 2>/dev/null | awk '{print $1; exit}'); " +
            "[ -n \"$ACTIVE\" ] || exit 0; " +
            "find \"$VERSIONS\" -mindepth 1 -maxdepth 1 ! -name \"$ACTIVE\" -exec rm -rf {} +"
        )
    }
    else {
        const platform = detectPlatform()

        info("install Tmux")
        ensureTool("tmux", {
            hint: platform.match(/^windows:/) ?
                "https://github.com/psmux/psmux/" :
                "https://github.com/tmux/tmux/",
            install: {
                "windows:winget": "winget install --accept-package-agreements --accept-source-agreements --silent -e psmux",
                "windows:choco":  "choco install -y --accept-license --no-progress psmux",
                "macos:ports":    "sudo port -N install tmux",
                "macos:brew":     "sudo brew install tmux",
                "linux:apt":      "sudo apt install -y tmux",
                "linux:apk":      "sudo apk add --no-interactive tmux"
            }
        })

        info("install LazyGit")
        ensureTool("lazygit", {
            optional: true,
            hint: "https://github.com/jesseduffield/lazygit/",
            install: {
                "windows:winget": "winget install --accept-package-agreements --accept-source-agreements --silent -e --id JesseDuffield.lazygit",
                "windows:choco":  "choco install -y --accept-license --no-progress lazygit",
                "macos:ports":    "sudo port -N install lazygit",
                "macos:brew":     "sudo brew install lazygit",
                "linux:apt":      "sudo apt install -y lazygit",
                "linux:apk":      "sudo apk add --no-interactive lazygit"
            }
        })

        info("install Git")
        ensureTool("git", {
            optional: true,
            hint: "https://git-scm.com",
            install: {
                "windows:winget": "winget install --accept-package-agreements --accept-source-agreements --silent -e --id Git.Git",
                "windows:choco":  "choco install -y --accept-license --no-progress git",
                "macos:ports":    "sudo port -N install git",
                "macos:brew":     "sudo brew install git",
                "linux:apt":      "sudo apt install -y git",
                "linux:apk":      "sudo apk add --no-interactive git"
            }
        })

        info("install Node.js")
        ensureTool([ "node", "npm" ], {
            hint: "https://nodejs.org",
            install: {
                "windows:winget": "winget install --accept-package-agreements --accept-source-agreements --silent -e --id OpenJS.NodeJS.LTS",
                "windows:choco":  "choco install -y --accept-license --no-progress nodejs",
                "macos:ports":    "sudo port -N install nodejs24 npm11",
                "macos:brew":     "sudo brew install node",
                "linux:apt":      "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs",
                "linux:apk":      "sudo apk add --no-interactive nodejs npm"
            }
        })

        info("install ANSI-Recolor")
        ensureTool("ansi-recolor", {
            hint: "https://github.com/rse/ansi-recolor",
            install: {
                "windows:*": "npm install -g ansi-recolor",
                "macos:*":   "sudo npm install -g ansi-recolor",
                "linux:*":   "sudo npm install -g ansi-recolor"
            }
        })

        info("install TypeScript-Language-Server")
        ensureTool("typescript-language-server", {
            hint: "https://github.com/typescript-language-server/typescript-language-server",
            install: {
                "windows:*": "npm install -g typescript-language-server",
                "macos:*":   "sudo npm install -g typescript-language-server",
                "linux:*":   "sudo npm install -g typescript-language-server"
            }
        })

        info("install CodeBurn")
        ensureTool("codeburn", {
            hint: "https://www.npmjs.com/package/codeburn",
            install: {
                "windows:*": "npm install -g codeburn",
                "macos:*":   "sudo npm install -g codeburn",
                "linux:*":   "sudo npm install -g codeburn"
            }
        })

        info("install ASE")
        ensureTool("ase", {
            hint: "https://ase.tools",
            install: {
                "windows:*": "npm install -g @rse/ase",
                "macos:*":   "sudo npm install -g @rse/ase",
                "linux:*":   "sudo npm install -g @rse/ase"
            }
        })

        info("install Claude Code")
        if (process.platform !== "win32") {
            /*  run installation script  */
            ensureTool("bash", { hint: "https://www.gnu.org/software/bash/" })
            ensureTool("curl", { hint: "https://curl.se/" })
            await execa("bash", [ "-c", `PATH="${HOME}/.local/bin:$PATH"; curl -kfsSL https://claude.ai/install.sh | bash` ], {
                stdio: "inherit", reject: false
            })

            /*  prune obsolete versions only after successful install  */
            pruneClaudeVersions(detectActiveClaudeVersion("claude"))
        }
        else {
            if (!process.env.PSModulePath)
                fatal("on Windows the \"install\" command has to be run from within a PowerShell session")

            /*  run installation script  */
            ensureTool("powershell")
            await execa("powershell", [ "-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex" ], {
                stdio: "inherit", reject: false
            })

            /*  prune obsolete versions only after successful install  */
            pruneClaudeVersions(detectActiveClaudeVersion("claude.exe"))
        }
    }
}

/*  action: update host-side or in-container components  */
const actionUpdate = async (capsula: boolean): Promise<void> => {
    /*  sanity check environment  */
    if (ENVIRONMENT === "capsula")
        fatal("cannot execute \"update\" command from within Capsula environment")

    /*  ensure we are not running from the home directory
        in order to not read-write mount its ~/.local/!  */
    try {
        process.chdir(basedir)
    }
    catch (_e) {
        fatal("cannot switch to base directory")
    }

    /*  dispatch according to host/container mode  */
    if (capsula) {
        info("update Debian GNU/Linux operating system")
        await self("internal", "capsula", "sudo", "apt", "update", "-qq")
        await self("internal", "capsula", "sudo", "apt", "upgrade", "-qq", "-y")

        info("update Claude Code")
        await self("internal", "capsula", "bash", "-c", `PATH="${HOME}/.local/bin:$PATH"; ${HOME}/.local/bin/claude update`)

        info("update ANSI-Recolor")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "ansi-recolor")

        info("update TypeScript LS")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "typescript-language-server")

        info("update CodeBurn")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "codeburn")

        info("update ASE")
        await self("internal", "capsula", "sudo", "-E", "npm", "install", "-y", "-g", "@rse/ase")

        info("update Claude wrapper")
        await self("internal", "capsula", "sudo", "install", "-c", "-m", "755", `${basedir}/claude`, "/usr/bin/claude")
    }
    else {
        info("update Tmux")
        executeCommand({
            "windows:winget": "winget upgrade --accept-package-agreements --accept-source-agreements --silent -e psmux",
            "windows:choco":  "choco upgrade -y --accept-license --no-progress psmux",
            "macos:ports":    "sudo port -N upgrade tmux",
            "macos:brew":     "sudo brew upgrade tmux",
            "linux:apt":      "sudo apt install --only-upgrade -y tmux",
            "linux:apk":      "sudo apk upgrade --no-interactive tmux"
        })

        info("update LazyGit")
        executeCommand({
            "windows:winget": "winget upgrade --accept-package-agreements --accept-source-agreements --silent -e --id JesseDuffield.lazygit",
            "windows:choco":  "choco upgrade -y --accept-license --no-progress lazygit",
            "macos:ports":    "sudo port -N upgrade lazygit",
            "macos:brew":     "sudo brew upgrade lazygit",
            "linux:apt":      "sudo apt install --only-upgrade -y lazygit",
            "linux:apk":      "sudo apk upgrade --no-interactive lazygit"
        })

        info("update Git")
        executeCommand({
            "windows:winget": "winget upgrade --accept-package-agreements --accept-source-agreements --silent -e --id Git.Git --source winget",
            "windows:choco":  "choco upgrade -y --accept-license --no-progress git",
            "macos:ports":    "sudo port -N upgrade git",
            "macos:brew":     "sudo brew upgrade git",
            "linux:apt":      "sudo apt install --only-upgrade -y git",
            "linux:apk":      "sudo apk upgrade --no-interactive git"
        })

        info("update Node.js")
        executeCommand({
            "windows:winget": "winget upgrade --accept-package-agreements --accept-source-agreements --silent -e --id OpenJS.NodeJS.LTS",
            "windows:choco":  "choco upgrade -y --accept-license --no-progress nodejs",
            "macos:ports":    "sudo port -N upgrade nodejs24 npm11",
            "macos:brew":     "sudo brew upgrade node",
            "linux:apt":      "sudo apt install --only-upgrade -y nodejs",
            "linux:apk":      "sudo apk upgrade --no-interactive nodejs npm"
        })

        info("update ANSI-Recolor")
        executeCommand({
            "windows:*": "npm install -g ansi-recolor",
            "macos:*":   "sudo npm install -g ansi-recolor",
            "linux:*":   "sudo npm install -g ansi-recolor"
        })

        info("update TypeScript-Language-Server")
        executeCommand({
            "windows:*": "npm install -g typescript-language-server",
            "macos:*":   "sudo npm install -g typescript-language-server",
            "linux:*":   "sudo npm install -g typescript-language-server"
        })

        info("update CodeBurn")
        executeCommand({
            "windows:*": "npm install -g codeburn",
            "macos:*":   "sudo npm install -g codeburn",
            "linux:*":   "sudo npm install -g codeburn"
        })

        info("update ASE")
        executeCommand({
            "windows:*": "npm install -g @rse/ase",
            "macos:*":   "sudo npm install -g @rse/ase",
            "linux:*":   "sudo npm install -g @rse/ase"
        })

        info("update Claude Code")
        if (process.platform !== "win32") {
            ensureTool("bash")
            await execa("bash", [ "-c", `PATH="${HOME}/.local/bin:$PATH"; ${HOME}/.local/bin/claude update` ], {
                stdio: "inherit", reject: false
            })

            /*  prune obsolete versions only after successful update  */
            pruneClaudeVersions(detectActiveClaudeVersion("claude"))
        }
        else {
            if (!process.env.PSModulePath)
                fatal("on Windows the \"update\" command has to be run from within a PowerShell session")
            ensureTool("powershell")
            await execa("powershell", [ "-NoProfile", "-Command", "claude update" ], {
                stdio: "inherit", reject: false
            })

            /*  prune obsolete versions only after successful update  */
            pruneClaudeVersions(detectActiveClaudeVersion("claude.exe"))
        }
    }
}

/*  action: internal "tmux" -- spawn tmux with our generated configuration.
    The tmux.conf bind-keys for new claude panes invoke "claudex" (which is
    expected to be in $PATH); the parent invocation's pass-through flags
    (e.g. "-R") are propagated to those panes via the CLAUDEX_FLAGS env var
    (set by actionDefault when entering tmux mode), which the env-merge in
    main() picks up.  */
const actionInternalTmux = (opts: TopOpts, args: string[]): never => {
    ensureTool("tmux")
    let conf = fs.readFileSync(path.join(basedir, "tmux.conf"), "utf8")
    if (opts.ase) {
        /*  ASE-specific bind-keys (only when "-A" is in effect)  */
        conf +=
            "bind-key q display-popup -E -w 95% -h 95% -T \"─◀#[reverse] ⧉ Task Edit (ase task edit) #[noreverse]▶\" claudex internal ase-task-edit\n" +
            "bind-key t send-keys \"/ase:ase-meta-task \"\n" +
            "bind-key p send-keys \"/ase:ase-meta-persona \"\n"
    }
    if (isPsmux()) {
        /*  psmux does not honor the reverse ANSI sequence in at least the statusline
            and not some expansions in the pane border format  */
        conf +=
            "set-option -g status-style                 bg=black,fg=color15\n" +
            "set-option -g status-left                  \" claudeX #[bg=blue,fg=color15] ※ @USER@ #[bg=black,fg=color15] #{?session_attached,#[bg=red,fg=color15] ⚑ #{session_name} #[bg=black,fg=color15],}\"\n" +
            "set-option -g window-status-current-style  bg=red,fg=color15\n" +
            "set-option -g window-status-bell-style     bg=blue,fg=color15\n" +
            "set-option -g window-status-activity-style bg=blue,fg=color15\n" +
            "set-option -g message-style                bg=blue,fg=color15\n" +
            "set-hook   -g -u pane-exited\n" +
            "set-hook   -g -u after-split-window\n" +
            "bind-key g display-popup -E -w 95% -h 95% -T \"─◀( ⧉ Version Control (lazygit) )▶\" claudex internal lazygit\n" +
            "bind-key s display-popup -E -w 95% -h 95% -T \"─◀( ⧉ Shell )▶\"                     claudex internal shell\n" +
            (opts.ase ? "bind-key q display-popup -E -w 95% -h 95% -T \"─◀( ⧉ Task Edit (ase task edit) )▶\" claudex internal ase-task-edit\n" : "")
    }
    conf = conf.replace(/@USER@/g, USER)
    const confFile = path.join(os.tmpdir(), `claudex-tmux-${process.pid}.conf`)
    fs.writeFileSync(confFile, conf, { mode: 0o600 })
    /*  ensure the temp config is removed on normal exit AND on signal-driven
        termination (SIGINT/SIGTERM); SIGKILL and process panics remain
        uncoverable. tmux.conf is read once at startup and not re-read via
        source-file, so early removal is safe.  */
    const cleanup = (): void => {
        try { fs.unlinkSync(confFile) }
        catch (_e) { /*  ignore  */ }
    }
    process.on("exit",    cleanup)
    process.on("SIGINT",  () => { cleanup(); process.exit(130) })
    process.on("SIGTERM", () => { cleanup(); process.exit(143) })
    const r = execaSync("tmux", [
        "-f", confFile,
        ...args
    ], {
        stdio:        "inherit",
        reject:       false,
        windowsHide:  false
    })
    cleanup()
    return process.exit(r.exitCode ?? 0)
}

/*  action: internal "shell" -- spawn an interactive login shell  */
const actionInternalShell = (_opts: TopOpts, args: string[]): never => {
    if (process.platform === "win32") {
        const shell = process.env.SHELL ?? process.env.ComSpec ?? "powershell"
        const name = path.basename(shell).toLowerCase().replace(/\.exe$/, "")
        if (name === "powershell" || name === "pwsh") {
            ensureTool(name)
            return execInherit(name, [ "-NoLogo", "-NoProfile", ...args ])
        }
        else {
            ensureTool(shell)
            return execInherit(shell, args)
        }
    }
    else {
        const shell = process.env.SHELL ?? "bash"
        ensureTool(shell)
        return execInherit(shell, [ "-l", ...args ])
    }
}

/*  action: internal "ase-task-edit" -- edit the ASE task associated with the current tmux pane  */
const actionInternalAseTaskEdit = async (_opts: TopOpts): Promise<void> => {
    ensureTool("ase")
    let tid = ""
    const r1 = execaSync("tmux", [ "display-message", "-p", "#{@ase_task_id}" ], { reject: false })
    tid = (r1.stdout ?? "").trim()
    if (tid !== "")
        execInherit("ase", [ "task", "edit", tid ])
    else {
        process.stderr.write("no ASE task id known for this pane yet\n")
        await new Promise((resolve) => setTimeout(resolve, 2000))
    }
}

/*  action: internal "lazygit" -- spawn lazygit (optionally recolored)  */
const actionInternalLazygit = (opts: TopOpts, args: string[]): never => {
    ensureTool("git")
    ensureTool("lazygit")
    const env: Env = { ...process.env, TERM: "xterm-color" }
    if (opts.recolor) {
        ensureTool("ansi-recolor")
        return execInherit("ansi-recolor", [
            "-c", path.join(basedir, "ansi-recolor.conf"),
            "-m",
            "-n", "lazygit",
            "-t", path.join(HOME, "ansi-recolor.txt"),
            "lazygit", "-ucf", path.join(basedir, "lazygit.yaml"),
            ...args
        ], { env })
    }
    return execInherit("lazygit", [
        "-ucf", path.join(basedir, "lazygit.yaml"),
        ...args
    ], { env })
}

/*  action: internal "capsula" -- enter/start a Capsula container with the curated env-var/dotfile setup  */
const actionInternalCapsula = (_opts: TopOpts, args: string[]): never => {
    /*  sanity check environment  */
    ensureTool("capsula")
    if (ENVIRONMENT === "capsula")
        fatal("cannot execute \"internal capsula\" command from within Capsula environment")

    /*  define list of environment variables  */
    const envs = [ "TERM", "HOME" ]
    const envOpts: string[] = [ "-e", "!" ]
    for (const e of envs)
        envOpts.push("-e", e)

    /*  find list of dot-files (relative to $HOME)  */
    const dotfiles = [
        ".inputrc",
        ".dotfiles/inputrc",
        ".bash_login",
        ".bash_logout",
        ".bashrc",
        ".dotfiles/bashrc",
        ".ssh/authorized_keys",
        ".ssh/known_hosts!",
        ".ssh/config",
        ".dotfiles/sshconfig",
        ".vimrc",
        ".dotfiles/vimrc",
        ".vim",
        ".tmux.conf",
        ".dotfiles/tmux.conf",
        ".gitconfig",
        ".dotfiles/gitconfig",
        ".npmrc",
        ".npm!",
        ".cache!",
        ".claude!",
        ".claude.json!"
    ]
    const dotfileOpts: string[] = [ "-m", "!" ]
    for (const dotfile of dotfiles) {
        const p = dotfile.endsWith("!") ? dotfile.slice(0, -1) : dotfile
        if (fs.existsSync(path.join(HOME, p)))
            dotfileOpts.push("-m", dotfile)
    }

    /*  find all sensitive ".env" files from current working
        directory up to root directory for hiding  */
    const nullOpts: string[] = [ "-n", "!" ]
    let dir = process.cwd()
    while (true) {
        const envFile = path.join(dir, ".env")
        if (fs.existsSync(envFile) && fs.statSync(envFile).isFile())
            nullOpts.push("-n", envFile)
        const parent = path.dirname(dir)
        if (parent === dir)
            break
        dir = parent
    }

    /*  execute  */
    return execInherit("capsula", [
        "-c", "claude",
        "-t", "debian",
        "-P", "linux/arm64",
        ...envOpts,
        ...dotfileOpts,
        ...nullOpts,
        "-p", "!",
        "-e", `CLAUDE_MODEL=${process.env.CLAUDE_MODEL ?? ""}`,
        "-e", `CLAUDEX=${basedir}`,
        "-b", basedir,
        ...args
    ])
}

/*  action: internal "exec" -- execute a command supplied via the
    $CLAUDEX_INTERNAL_EXEC environment variable. The variable value is split
    into argv via shell-quote (honoring '..' and ".." quoting, no shell
    expansion of operators), and then the resulting command is run with stdio
    inherited. This indirection exists to work around platforms (notably
    Windows tmux) that mishandle quoting when a command is passed via "tmux
    new-session" as multiple trailing argv items: we instead pass the whole
    command as a single env-var value.  */
const actionInternalExec = (_opts: TopOpts): never => {
    const cmdline = process.env.CLAUDEX_INTERNAL_EXEC ?? ""
    if (cmdline === "")
        fatal("CLAUDEX_INTERNAL_EXEC environment variable is empty or unset")
    const parsed = shQ.parse(cmdline)
    const argv: string[] = []
    for (const tok of parsed) {
        if (typeof tok === "string")
            argv.push(tok)
        else
            fatal("CLAUDEX_INTERNAL_EXEC contains unsupported shell construct (operators, globs, or env-var expansion are not allowed)")
    }
    if (argv.length === 0)
        fatal("CLAUDEX_INTERNAL_EXEC contains no command to execute")
    const [ file, ...rest ] = argv
    return execInherit(file, rest)
}

/*  action: "stats" -- show Claude Code usage statistics via codeburn  */
const actionStats = async (args: string[]): Promise<never> => {
    ensureTool("codeburn", { hint: "run \"claudex install\" or \"claudex update\" first" })
    return execInherit("codeburn", [ "report", "--provider", "claude", "--period", "30days", ...args ])
}

/*  action: internal sub-dispatch (tmux, shell, ase-task-edit, lazygit, capsula, exec)  */
const actionInternal = async (opts: TopOpts, args: string[]): Promise<void> => {
    const util = args[0]
    const rest = args.slice(1)
    switch (util) {
        case "tmux":          return actionInternalTmux(opts, rest)
        case "shell":         return actionInternalShell(opts, rest)
        case "ase-task-edit": return actionInternalAseTaskEdit(opts)
        case "lazygit":       return actionInternalLazygit(opts, rest)
        case "capsula":       return actionInternalCapsula(opts, rest)
        case "exec":          return actionInternalExec(opts)
        default:
            fatal(`invalid internal command "${util ?? ""}"`)
    }
}

/*  action: top-level command -- run "claude"  */
const actionDefault = (opts: TopOpts, args: string[]): never => {
    /*  build the inner self-invocation flag list. Pass-through "-R"/"-A" only,
        as "-C" and "-T" are consumed at the outer layer to avoid recursion.  */
    const innerFlags: string[] = []
    if (opts.recolor)
        innerFlags.push("-R")
    if (opts.ase)
        innerFlags.push("-A")

    /*  branch: tmux mode (with or without capsula)  */
    if (opts.tmux) {
        /*  sanity check environment  */
        if (ENVIRONMENT === "capsula")
            fatal("cannot execute tmux mode from within Capsula environment")

        /*  determine session name (from "-T <name>" option value, or auto-detected)  */
        let session: string
        if (typeof opts.tmux === "string" && opts.tmux !== "")
            session = opts.tmux
        else
            session = detectSessionName()
        const rest = args

        /*  build the in-pane self-invocation  */
        const inPane = shQ.quote([ process.execPath, selfPathJS, ...innerFlags, ...rest ])

        /*  propagate the chosen pass-through flags to subsequent in-pane
            "claudex" invocations via the CLAUDEX_FLAGS env var (honored by
            the env-merge in main())  */
        const claudexFlags = innerFlags.join(" ")

        /*  dispatch according to global options  */
        if (opts.capsula) {
            /*  enter/start container, then run tmux inside it  */
            ensureTool("docker")
            const container = `capsula-${USER}-debian-claude-${session}`
            const inspect = execaSync("docker", [ "inspect", "-f", "{{.State.Running}}", container ], { reject: false })
            if (inspect.exitCode === 0) {
                /*  start the container if it exists but is not running  */
                if (inspect.stdout.trim() !== "true")
                    execaSync("docker", [ "start", container ], { reject: false, stdio: "ignore" })

                /*  enter already running container and run tmux  */
                return execInherit("docker", [
                    "exec", "-i", "-t", container,
                    "bash", "-c",
                    `TERM=${shQ.quote([ TERM ])} ` +
                    `HOME=${shQ.quote([ HOME ])} ` +
                    `CLAUDEX_FLAGS=${shQ.quote([ claudexFlags ])} ` +
                    `sudo -E -u ${shQ.quote([ USER ])} ` +
                    `${shQ.quote([ process.execPath, selfPathJS ])} ` +
                    `${opts.ase ? "-A " : ""}internal tmux new-session -A -s ${shQ.quote([ session ])}`
                ])
            }
            else {
                /*  start a new container and run tmux  */
                return execInherit(process.execPath, [
                    selfPathJS, "internal", "capsula",
                    "-e", `CLAUDEX_FLAGS=${claudexFlags}`,
                    "-e", `CLAUDEX_INTERNAL_EXEC=${inPane}`,
                    "-C", container, process.execPath, selfPathJS,
                    ...(opts.ase ? [ "-A" ] : []), "internal", "tmux",
                    "new-session", "-A", "-s", session, "-n", "claude",
                    "claudex", "internal", "exec"
                ])
            }
        }
        else {
            /*  enter/start plain tmux  */
            return execInherit(process.execPath, [
                selfPathJS,
                ...(opts.ase ? [ "-A" ] : []), "internal", "tmux",
                "new-session", "-A", "-s", session, "-n", "claude",
                "claudex", "internal", "exec"
            ], {
                env: {
                    CLAUDEX_FLAGS: claudexFlags,
                    CLAUDEX_INTERNAL_EXEC: inPane
                }
            })
        }
    }

    /*  branch: capsula-only mode  */
    if (opts.capsula) {
        if (ENVIRONMENT === "capsula")
            fatal("cannot execute capsula mode from within Capsula environment")
        ensureTool("docker")
        const session = detectSessionName()
        const container = `capsula-${USER}-debian-claude-${session}`
        const inspect = execaSync("docker", [ "inspect", "-f", "{{.State.Running}}", container ], { reject: false })
        const passthru = [ ...innerFlags, ...args ]
        if (inspect.exitCode === 0) {
            /*  start the container if it exists but is not running  */
            if (inspect.stdout.trim() !== "true")
                execaSync("docker", [ "start", container ], { reject: false, stdio: "ignore" })

            /*  enter already running container and run claude (single-quote shell-escape)  */
            return execInherit("docker", [
                "exec", "-i", "-t", container,
                "bash", "-c",
                `TERM=${shQ.quote([ TERM ])} ` +
                `HOME=${shQ.quote([ HOME ])} ` +
                `sudo -E -u ${shQ.quote([ USER ])} ` +
                `${shQ.quote([ process.execPath, selfPathJS ])} ` +
                `${shQ.quote(passthru)}`
            ])
        }
        else {
            /*  start a new container and run claude  */
            return execInherit(process.execPath, [
                selfPathJS,
                "internal", "capsula", "-C", container,
                process.execPath, selfPathJS,
                ...passthru
            ])
        }
    }

    /*  branch: plain claude -- execute Claude Code, optionally
        wrapped with ansi-recolor when "-R" was given  */
    const recolor = opts.recolor === true
    if (recolor)
        ensureTool("ansi-recolor")
    process.env.PATH = `${HOME}/.local/bin:${process.env.PATH ?? ""}`
    ensureTool("claude")
    const env: Env = { ...process.env }
    const claudeModel = process.env.CLAUDE_MODEL ?? ""
    if (/^ollama:/.test(claudeModel)) {
        /*  parse ollama[://<host>[:<port>]]/<model>[?[context=<size>],[capabilities=<list>]]  */
        let remainder = claudeModel.slice("ollama:".length)
        let ohost = "localhost:11434"
        if (remainder.startsWith("//")) {
            remainder = remainder.slice(2)
            const slash = remainder.indexOf("/")
            if (slash >= 0) {
                ohost = remainder.slice(0, slash)
                remainder = remainder.slice(slash + 1)
            }
            else {
                ohost = remainder
                remainder = ""
            }
        }
        else if (remainder.startsWith("/"))
            remainder = remainder.slice(1)
        const qIdx = remainder.indexOf("?")
        const model = qIdx >= 0 ? remainder.slice(0, qIdx) : remainder
        if (model === "")
            fatal("invalid CLAUDE_MODEL: missing model name in " +
                `"${claudeModel}" (expected: ollama:[//host[:port]]/<model>[?...])`)
        let context = "200k"
        let capabilities = ""
        if (qIdx >= 0) {
            const query = remainder.slice(qIdx + 1)
            for (const pair of query.split(",")) {
                const eq = pair.indexOf("=")
                const key = eq >= 0 ? pair.slice(0, eq) : pair
                const val = eq >= 0 ? pair.slice(eq + 1) : ""
                if (key === "context")           context      = val
                else if (key === "capabilities") capabilities = val
            }
        }

        /*  override Claude Code configuration  */
        env.ANTHROPIC_API_KEY                = ""
        env.ANTHROPIC_AUTH_TOKEN             = "ollama"
        env.ANTHROPIC_BASE_URL               = `http://${ohost}`
        env.ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES = capabilities
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL    = model
        env.ANTHROPIC_DEFAULT_OPUS_MODEL     = model
        env.ANTHROPIC_DEFAULT_SONNET_MODEL   = model
        env.CLAUDE_CODE_ATTRIBUTION_HEADER   = "0"
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW  = context
        env.CLAUDE_CODE_SUBAGENT_MODEL       = model
        env.DISABLE_LOGIN_COMMAND            = "1"
        env.DISABLE_LOGOUT_COMMAND           = "1"
    }

    /*  override ASE configuration (for its diagram rendering)  */
    if (opts.ase) {
        if (process.env.ASE_TERM_WIDTH === undefined) {
            let width = 0
            if (process.stdout.isTTY) {
                const cols = process.stdout.columns
                if (typeof cols === "number" && cols > 0)
                    width = cols
            }
            process.env.ASE_TERM_WIDTH = `${width}`
        }
        if (process.env.ASE_TERM_COLORS === undefined) {
            let colorMode = "none"
            const depth = process.stdout.getColorDepth()
            if (depth >= 8)
                colorMode = "ansi256"
            else if (depth >= 4)
                colorMode = "ansi16"
            process.env.ASE_TERM_COLORS = `${colorMode}`
        }
    }

    /*  determine Claude Code settings  */
    let claudeSettings = {
        "env": {
            "DISABLE_TELEMETRY":       "1",
            "DISABLE_AUTOUPDATER":     "1",
            "DISABLE_BUG_COMMAND":     "1",
            "DISABLE_ERROR_REPORTING": "1"
        },
        "verbose": false,
        "spinnerTipsEnabled": false,
        "spinnerVerbs": {
            "mode": "replace",
            "verbs": [
                "Working",
                "Working (Just be patient)"
            ]
        }
    } as Record<string, unknown>
    if (opts.ase) {
        claudeSettings = deepmerge(claudeSettings, {
            "statusLine": {
                "type": "command",
                "command": "ase statusline -w 0 -m 2 '<blue>%u</blue> <red>%p</red> <black>%T</black> %s' '%m %e %t' '%P %c'",
                "padding": 0
            }
        })
    }
    if (opts.tmux) {
        claudeSettings = deepmerge(claudeSettings, {
            "env": {
                "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
            },
            "teammateMode": "tmux",
            "preferences": {
                "tmuxSplitPanes": true
            }
        })
    }

    /*  execute "claude"  */
    const claudeBin = path.join(HOME, ".local/bin/claude")
    if (recolor) {
        return execInherit("ansi-recolor", [
            "-c", path.join(basedir, "ansi-recolor.conf"),
            "-m",
            "-n", "claude",
            "-t", path.join(HOME, "ansi-recolor.txt"),
            claudeBin,
            "--settings", JSON.stringify(claudeSettings),
            ...args
        ], { env })
    }
    else {
        return execInherit(claudeBin, [
            "--settings", JSON.stringify(claudeSettings),
            ...args
        ], { env })
    }
}

/*  action: top-level "-h/--help"  */
const actionHelp = (): never => {
    /*  run "claude --help"  */
    process.env.PATH = `${HOME}/.local/bin:${process.env.PATH ?? ""}`
    ensureTool("claude")
    const claudeBin = path.join(HOME, ".local/bin/claude")
    execaSync(claudeBin, [ "--help" ], { reject: false, stdio: [ "ignore", "inherit", "inherit" ] })

    /*  append our claudeX extension information  */
    process.stdout.write(
        "\n" +
        "claudeX extension options (honored before claude):\n" +
        "  -C, --capsula        execute Claude Code inside a Capsula sandbox container\n" +
        "  -T, --tmux [session] wrap Claude Code in a Tmux terminal multiplexing session (optional session name)\n" +
        "  -R, --recolor        wrap Claude Code with ANSI recoloring for improved theming\n" +
        "  -A, --ase            enable ASE-specific Claude Code statusline and ASE_* environment variables\n" +
        "\n" +
        "claudeX extension subcommands (honored before claude):\n" +
        "  install              install host-side or in-container dependencies\n" +
        "  update               update  host-side or in-container dependencies\n" +
        "  stats                show Claude Code usage statistics\n" +
        "  internal …           internal command dispatcher (internal use only)\n"
    )
    process.exit(0)
}

/*  the main procedure -- builds and dispatches according to options and commands  */
const main = async (): Promise<void> => {
    /*  honor the external CLAUDEX_FLAGS environment variable as a way to set
        the top-level "-R"/"-C"/"-T"/"-A" flags by default. Merge env-derived
        flags with the command-line flags (env first, command-line second, so
        the user can extend or override on the command line). Skip for the
        "internal" sub-dispatch (which uses CLAUDEX_FLAGS_PASSTHROUGH for
        tmux.conf bind-key flag propagation), and skip flags that are already
        present on argv to avoid duplicating boolean options.  */
    {
        const topArgs = process.argv.slice(2)
        const subcmd = topArgs.find((a) => !a.startsWith("-")) ?? ""
        const envFlags = (process.env.CLAUDEX_FLAGS ?? "").trim()
        const claudeNativeSubcmds = [
            "agents", "auth", "auto-mode", "doctor", "mcp",
            "plugin", "plugins", "project", "setup-token", "ultrareview"
        ]
        const isClaudeNative = claudeNativeSubcmds.includes(subcmd)
        if (envFlags !== "" && subcmd !== "internal" && !isClaudeNative) {
            const aliases: Record<string, string> = {
                "-R": "--recolor", "--recolor": "-R",
                "-C": "--capsula", "--capsula": "-C",
                "-T": "--tmux",    "--tmux":    "-T",
                "-A": "--ase",     "--ase":     "-A"
            }
            const present = (tok: string): boolean => {
                if (topArgs.includes(tok))
                    return true
                const alt = aliases[tok]
                if (alt !== undefined && topArgs.includes(alt))
                    return true
                return false
            }
            const tokens = envFlags.split(/\s+/).filter((t) => t !== "")
            const toInsert = tokens.filter((t) => !present(t))
            if (toInsert.length > 0)
                process.argv.splice(2, 0, ...toInsert)
        }
    }

    /*  intercept top-level "-h/--help" before commander grabs it, so we can
        pass-through to "claude --help" and append our extension info  */
    const topArgs = process.argv.slice(2)
    const firstNonFlag = topArgs.findIndex((a) => !a.startsWith("-"))
    const headFlags = firstNonFlag < 0 ? topArgs : topArgs.slice(0, firstNonFlag)
    const subcmd = firstNonFlag < 0 ? "" : topArgs[firstNonFlag]
    if ((headFlags.includes("-h") || headFlags.includes("--help"))
        && subcmd !== "install" && subcmd !== "update" && subcmd !== "internal")
        actionHelp()

    /*  dispatch main command  */
    const program = new Command()
    program
        .name("claudex")
        .description("Claude Code eXtended")
        .version(JSON.parse(fs.readFileSync(path.join(basedir, "package.json"), "utf8")).version, "-V, --version")
        .enablePositionalOptions()
        .passThroughOptions()
        .allowUnknownOption()
        .helpOption(false)
        .option("-C, --capsula",        "execute Claude Code inside a Capsula sandbox container")
        .option("-T, --tmux [session]", "wrap Claude Code in a Tmux terminal multiplexing session (optional session name)")
        .option("-R, --recolor",        "wrap Claude Code with ANSI recoloring for improved theming")
        .option("-A, --ase",            "enable ASE-specific Claude Code statusline and ASE_* environment variables")
        .argument("[args...]",          "arguments passed unparsed to Claude Code")
        .action((args: string[], opts: TopOpts) => {
            actionDefault(opts, args)
        })

    /*  dispatch "install" sub-command  */
    program
        .command("install")
        .description("install host-side or in-container dependencies")
        .helpOption("-h, --help", "display help for command")
        .action(async (_opts: object, cmd: Command) => {
            const capsula = cmd.parent?.opts().capsula === true
            await actionInstall(capsula)
        })

    /*  dispatch "update" sub-command  */
    program
        .command("update")
        .description("update host-side or in-container dependencies")
        .helpOption("-h, --help", "display help for command")
        .action(async (_opts: object, cmd: Command) => {
            const capsula = cmd.parent?.opts().capsula === true
            await actionUpdate(capsula)
        })

    /*  dispatch "stats" sub-command  */
    program
        .command("stats")
        .description("show Claude Code usage statistics")
        .helpOption("-h, --help", "display help for command")
        .allowUnknownOption()
        .argument("[args...]", "additional arguments passed to codeburn")
        .action(async (args: string[]) => {
            await actionStats(args)
        })

    /*  dispatch "internal" sub-command  */
    program
        .command("internal")
        .description("internal command dispatcher (tmux, shell, lazygit, ase-task-edit, capsula)")
        .helpOption("-h, --help", "display help for command")
        .allowUnknownOption()
        .argument("[args...]", "internal command name and its arguments")
        .action(async (args: string[], _opts: object, cmd: Command) => {
            const opts = (cmd.parent?.opts() ?? {}) as TopOpts
            await actionInternal(opts, args)
        })

    await program.parseAsync(process.argv)
}
main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    fatal(msg)
})

