#!/usr/bin/env node
/*!
**  claudeX -- Claude Code eXtended
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under MIT <https://spdx.org/licenses/MIT>
*/

import * as fs              from "node:fs"
import * as path            from "node:path"
import * as os              from "node:os"
import { execa, execaSync } from "execa"
import which                from "which"
import chalk                from "chalk"

/*  type for environment variable map  */
type Env = Record<string, string>

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

/*  the path used for self-invocation: always the POSIX-sh launcher
    next to the compiled JS, since the JS itself is not executable
    and embedded shell strings (docker/tmux) need a runnable command  */
const selfPath   = path.join(basedir, "claudex")
const selfPathJS = process.argv[1] ?? path.join(basedir, "claudex.js")

/*  command line arguments (after node and script path)  */
let argv = process.argv.slice(2)

/*  helper for displaying info messages  */
const info = (msg: string): void => {
    process.stderr.write(`${chalk.blue("claudex: ")}${chalk.blue.bold("INFO:")}${chalk.blue(` ${msg}`)}\n`)
}

/*  helper for raising a fatal error  */
const fatal = (msg: string): never => {
    process.stderr.write(`${chalk.red("claudex: ")}${chalk.red.bold("ERROR:")}${chalk.red(` ${msg}`)}\n`)
    process.exit(1)
}

/*  helper to ensure a tool is available  */
const ensureTool = (tool: string, options: { hint?: string, optional?: boolean } = {}): void => {
    const r = which.sync(tool, { nothrow: true })
    if (r === null) {
        if (options.optional)
            return
        if (options.hint !== undefined)
            fatal(`required tool "${tool}" not found in $PATH -- hint: ${options.hint}`)
        else
            fatal(`required tool "${tool}" not found in $PATH`)
    }
}

/*  helper to spawn a child synchronously inheriting stdio, then exit
    with its code (the closest equivalent of Bash "exec ...")  */
const execInherit = async (file: string, args: string[], opts: { env?: Env } = {}): Promise<never> => {
    const r = await execa(file, args, {
        stdio:        "inherit",
        env:          opts.env,
        reject:       false,
        windowsHide:  false
    })
    process.exit(r.exitCode ?? 0)
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

/*  sanity check usage  */
if (argv.length === 0) {
    process.stderr.write("claudex: ERROR: missing command\n")
    process.stderr.write("claudex: USAGE: claudex install\n")
    process.stderr.write("claudex: USAGE: claudex update\n")
    process.stderr.write("claudex: USAGE: claudex session\n")
    process.stderr.write("claudex: USAGE: claudex shell [...]\n")
    process.stderr.write("claudex: USAGE: claudex claude [...]\n")
    process.exit(1)
}

/*  support special "-s" (sandbox) option  */
let sandbox = false
if (argv.length >= 1 && argv[0] === "-s") {
    argv = argv.slice(1)
    sandbox = true
}

/*  determine command  */
const cmd = argv[0]
argv = argv.slice(1)

/*  determine information  */
const HOME        = process.env.HOME ?? os.homedir()
const USER        = process.env.USER ?? ""
const TERM        = process.env.TERM ?? ""
const ENVIRONMENT = process.env.ENVIRONMENT ?? ""

/*  the main procedure  */
const main = async (): Promise<void> => {
    /*  dispatch according to command  */
    switch (cmd) {
        case "version": {
            const ver = JSON.parse(fs.readFileSync(path.join(basedir, "package.json"), "utf8")).version
            process.stdout.write(`claudeX ${ver}\n`)
            break
        }

        case "install": {
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
            if (sandbox) {
                info("update Debian GNU/Linux operating system")
                await self("shell", "-s", "sudo", "-E", "apt", "update", "-qq")
                await self("shell", "-s", "sudo", "-E", "apt", "upgrade", "-qq", "-y")

                info("install Tmux / LF / LazyGit / Git")
                await self("shell", "-s", "sudo", "-E", "apt", "install", "-qq", "-y", "tmux", "lf", "lazygit", "git")

                info("install Node.js")
                await self("shell", "-s", "sudo", "-E", "bash", "-c", "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -")
                await self("shell", "-s", "sudo", "-E", "apt", "install", "-qq", "-y", "nodejs")
                await self("shell", "-s", "sudo", "-E", "apt", "install", "-qq", "-y", "binutils", "gcc", "g++", "make")

                info("install Claude Code")
                await self("shell", "bash", "-c", "rm -f $HOME/.local/bin/claude")
                await self("shell", "bash", "-c", "rm -f $HOME/.local/share/claude/versions/*")
                await self("shell", "bash", "-c", `PATH="${HOME}/.local/bin:$PATH"; curl -kfsSL https://claude.ai/install.sh | bash`)

                info("install ANSI-Recolor")
                await self("shell", "-s", "sudo", "-E", "npm", "install", "-y", "-g", "ansi-recolor")

                info("install TypeScript LS")
                await self("shell", "-s", "sudo", "-E", "npm", "install", "-y", "-g", "typescript-language-server")

                info("install Claude wrapper")
                await self("shell", "-s", "sudo", "install", "-c", "-m", "755", `${basedir}/claude`, "/usr/bin/claude")
            }
            else {
                info("checking dependencies")
                if (process.platform !== "win32")
                    ensureTool("tmux", { hint: "https://github.com/tmux/tmux/" })
                else
                    ensureTool("tmux", { hint: "https://github.com/psmux/psmux" })
                ensureTool("lf", { hint: "https://github.com/gokcehan/lf/" })
                ensureTool("lazygit", { hint: "https://github.com/jesseduffield/lazygit/" })
                ensureTool("git", { hint: "https://git-scm.com" })
                ensureTool("node", { hint: "https://nodejs.org" })
                ensureTool("ansi-recolor", { hint: "npm install -g ansi-recolor" })
                ensureTool("typescript-language-server", { hint: "npm install -g typescript-language-server" })

                info("install Claude Code")
                if (process.platform !== "win32") {
                    /*  remove obsolete versions  */
                    try { fs.unlinkSync(path.join(HOME, ".local/bin/claude")) } catch (_e) {}
                    const versionsDir = path.join(HOME, ".local/share/claude/versions")
                    if (fs.existsSync(versionsDir)) {
                        for (const f of fs.readdirSync(versionsDir))
                            try { fs.unlinkSync(path.join(versionsDir, f)) } catch (_e) {}
                    }

                    /*  run installation script  */
                    ensureTool("bash", { hint: "https://www.gnu.org/software/bash/" })
                    ensureTool("curl", { hint: "https://curl.se/" })
                    await execa("bash", [ "-c", `PATH="${HOME}/.local/bin:$PATH"; curl -kfsSL https://claude.ai/install.sh | bash` ], {
                        stdio: "inherit", reject: false
                    })
                }
                else {
                    if (!process.env.PSModulePath)
                        fatal("on Windows the \"install\" command has to be run from within a PowerShell session")

                    /*  remove obsolete versions  */
                    try { fs.unlinkSync(path.join(HOME, ".local/bin/claude.exe")) } catch (_e) {}
                    const versionsDir = path.join(HOME, ".local/share/claude/versions")
                    if (fs.existsSync(versionsDir)) {
                        for (const f of fs.readdirSync(versionsDir))
                            try { fs.unlinkSync(path.join(versionsDir, f)) } catch (_e) {}
                    }

                    /*  run installation script  */
                    ensureTool("powershell")
                    await execa("powershell", [ "-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex" ], {
                        stdio: "inherit", reject: false
                    })
                }
            }
            break
        }

        case "update": {
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
            if (sandbox) {
                info("update Debian GNU/Linux operating system")
                await self("shell", "-s", "sudo", "apt", "update", "-qq")
                await self("shell", "-s", "sudo", "apt", "upgrade", "-qq", "-y")

                info("update Claude Code")
                await self("shell", "bash", "-c", `PATH="${HOME}/.local/bin:$PATH"; ${HOME}/.local/bin/claude update`)

                info("update ANSI-Recolor")
                await self("shell", "-s", "sudo", "-E", "npm", "install", "-y", "-g", "ansi-recolor")

                info("update TypeScript LS")
                await self("shell", "-s", "sudo", "-E", "npm", "install", "-y", "-g", "typescript-language-server")

                info("update Claude wrapper")
                await self("shell", "-s", "sudo", "install", "-c", "-m", "755", `${basedir}/claude`, "/usr/bin/claude")
            }
            else {
                info("update Claude Code")
                if (process.platform !== "win32") {
                    ensureTool("bash")
                    await execa("bash", [ "-c", `PATH="${HOME}/.local/bin:$PATH"; ${HOME}/.local/bin/claude update` ], {
                        stdio: "inherit", reject: false
                    })
                }
                else {
                    if (!process.env.PSModulePath)
                        fatal("on Windows the \"update\" command has to be run from within a PowerShell session")
                    ensureTool("powershell")
                    await execa("powershell", [ "-NoProfile", "-Command", "claude update" ], {
                        stdio: "inherit", reject: false
                    })
                }
            }
            break
        }

        case "session": {
            /*  sanity check environment  */
            if (ENVIRONMENT === "capsula")
                fatal("cannot execute \"session\" command from within Capsula environment")

            /*  determine session name  */
            let session = "default"
            if (argv.length >= 1) {
                session = argv[0]
                argv = argv.slice(1)
            }
            else {
                let dir = process.cwd()
                while (dir !== "/") {
                    if (fs.existsSync(path.join(dir, "AGENTS.md")) || fs.existsSync(path.join(dir, "CLAUDE.md"))) {
                        session = path.basename(dir)
                        break
                    }
                    dir = path.dirname(dir)
                }
            }

            /*  dispatch according to environment  */
            if (sandbox) {
                /*  enter/start container  */
                ensureTool("docker")
                const container = `capsula-${USER}-debian-claude-${session}`
                const inspect = execaSync("docker", [ "inspect", container ], { reject: false, stdio: "ignore" })
                if (inspect.exitCode === 0) {
                    /*  enter already running container and run tmux  */
                    await execInherit("docker", [
                        "exec", "-i", "-t", container,
                        "bash", "-c",
                        `TERM=${TERM} HOME=${HOME} sudo -E -u ${USER} ${selfPath} util tmux new-session -A -s "${session}"`
                    ])
                }
                else {
                    /*  start a new container and run tmux  */
                    await self("shell", "-C", container, selfPath, "util", "tmux", "new-session", "-A", "-s", session, "-n", "claude", selfPath + " claude")
                    process.exit(0)
                }
            }
            else {
                /*  enter/start plain tmux  */
                await execInherit(selfPath, [ "util", "tmux", "new-session", "-A", "-s", session, "-n", "claude", `${selfPath} claude` ])
            }
            break
        }

        case "naked": {
            /*  sanity check environment  */
            if (ENVIRONMENT === "capsula")
                fatal("cannot execute \"naked\" command from within Capsula environment")

            /*  dispatch according to environment  */
            if (sandbox) {
                ensureTool("docker")
                const session = "default"
                const container = `capsula-${USER}-debian-claude-${session}`
                const inspect = execaSync("docker", [ "inspect", container ], { reject: false, stdio: "ignore" })
                if (inspect.exitCode === 0) {
                    /*  enter already running container and run claude  */
                    const passthru = argv.map((a) => `"${a.replace(/"/g, "\\\"")}"`).join(" ")
                    await execInherit("docker", [
                        "exec", "-i", "-t", container,
                        "bash", "-c",
                        `TERM=${TERM} HOME=${HOME} sudo -E -u ${USER} ${selfPath} claude ${passthru}`
                    ])
                }
                else {
                    /*  start a new container and run claude  */
                    await self("shell", "-C", container, selfPath, "claude", ...argv)
                    process.exit(0)
                }
            }
            else {
                /*  enter/start plain claude  */
                await execInherit(selfPath, [ "claude", ...argv ])
            }
            break
        }

        case "shell": {
            /*  sanity check environment  */
            ensureTool("capsula")
            if (ENVIRONMENT === "capsula")
                fatal("cannot execute \"shell\" command from within Capsula environment")

            /*  define list of environment variables  */
            const envs = [ "TERM", "HOME" ]
            const env_opts: string[] = [ "-e", "!" ]
            for (const e of envs)
                env_opts.push("-e", e)

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
            const dotfile_opts: string[] = [ "-m", "!" ]
            for (const dotfile of dotfiles) {
                const p = dotfile.endsWith("!") ? dotfile.slice(0, -1) : dotfile
                if (fs.existsSync(path.join(HOME, p)))
                    dotfile_opts.push("-m", dotfile)
            }

            /*  find all sensitive ".env" files from current working
                directory up to root directory for hiding  */
            const null_opts: string[] = [ "-n", "!" ]
            let dir = process.cwd()
            while (true) {
                const envFile = path.join(dir, ".env")
                if (fs.existsSync(envFile) && fs.statSync(envFile).isFile())
                    null_opts.push("-n", envFile)
                if (dir === "/")
                    break
                dir = path.dirname(dir)
            }

            /*  execute  */
            await execInherit("capsula", [
                "-c", "claude",
                "-t", "debian",
                "-P", "linux/arm64",
                ...env_opts,
                ...dotfile_opts,
                ...null_opts,
                "-p", "!",
                "-e", `CLAUDE_MODEL=${process.env.CLAUDE_MODEL ?? ""}`,
                "-e", `CLAUDEX=${basedir}`,
                "-b", basedir,
                ...argv
            ])
            break
        }

        case "claude": {
            /*  execute Claude Code  */
            process.env.PATH = `${HOME}/.local/bin:${process.env.PATH ?? ""}`
            ensureTool("ansi-recolor")
            ensureTool("claude")
            ensureTool("node")
            ensureTool("npm")
            const env: Env = { ...process.env as Env }
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
                try {
                    const { stdout } = execaSync("tput", [ "colors" ], { reject: false })
                    const n = parseInt(stdout.trim(), 10)
                    if (!Number.isNaN(n) && n >= 256)
                        colorMode = "ansi256"
                    else if (!Number.isNaN(n) && n >= 16)
                        colorMode = "ansi16"
                }
                catch (_e) {
                    /*  ignore  */
                }
                process.env.ASE_TERM_COLORS = `${colorMode}`
            }

            const settingsRaw = fs.readFileSync(path.join(basedir, "claude-settings.json"), "utf8")
            const settings = settingsRaw.replace(/@BASEDIR@/g, basedir)
            await execInherit("ansi-recolor", [
                "-c", path.join(basedir, "ansi-recolor.conf"),
                "-m",
                "-n", "claude",
                "-t", path.join(HOME, "ansi-recolor.txt"),
                path.join(HOME, ".local/bin/claude"),
                "--settings", settings,
                ...argv
            ], { env })
            break
        }

        case "util": {
            const util = argv[0]
            argv = argv.slice(1)
            switch (util) {
                case "tmux": {
                    ensureTool("tmux")
                    await execInherit("tmux", [
                        "-f", path.join(basedir, "tmux.conf"),
                        "bind-key", "c",   "new-window",   "-c", "#{pane_current_path}", "-n", "claude", `${selfPath} claude`, ";",
                        "bind-key", "|",   "split-window", "-c", "#{pane_current_path}", "-h",           `${selfPath} claude`, ";",
                        "bind-key", "-",   "split-window", "-c", "#{pane_current_path}", "-v",           `${selfPath} claude`, ";",
                        "bind-key", "g", "display-popup", "-E", "-w", "95%", "-h", "95%",
                            "-T", "─◀#[reverse] ⧉ Version Control (lazygit) #[noreverse]▶", `${selfPath} util lazygit`, ";",
                        "bind-key", "b", "display-popup", "-E", "-w", "95%", "-h", "95%",
                            "-T", "─◀#[reverse] ⧉ Shell (bash) #[noreverse]▶",              `${selfPath} util bash`, ";",
                        "bind-key", "f", "display-popup", "-E", "-w", "95%", "-h", "95%",
                            "-T", "─◀#[reverse] ⧉ File Browser (lf) #[noreverse]▶",         `${selfPath} util lf`, ";",
                        "bind-key", "q", "display-popup", "-E", "-w", "95%", "-h", "95%",
                            "-T", "─◀#[reverse] ⧉ Task Edit (ase task edit) #[noreverse]▶", `${selfPath} util ase-task-edit`, ";",
                        ...argv
                    ])
                    break
                }
                case "lf": {
                    ensureTool("ansi-recolor")
                    ensureTool("lf")
                    ensureTool("vim")
                    await execInherit("ansi-recolor", [
                        "-c", path.join(basedir, "ansi-recolor.conf"),
                        "-m",
                        "-n", "lf",
                        "-t", path.join(HOME, "ansi-recolor.txt"),
                        "lf", "-config", path.join(basedir, "lf.conf"),
                        ...argv
                    ])
                    break
                }
                case "bash": {
                    ensureTool("bash")
                    await execInherit("bash", [ "-l", ...argv ])
                    break
                }
                case "ase-task-edit": {
                    ensureTool("ase")
                    let tid = ""
                    const r1 = execaSync("tmux", [ "display-message", "-p", "#{@ase_task_id}" ], { reject: false })
                    tid = (r1.stdout ?? "").trim()
                    if (tid !== "")
                        await execInherit("ase", [ "task", "edit", tid ])
                    else {
                        process.stderr.write("no ASE task id known for this pane yet\n")
                        await new Promise((resolve) => setTimeout(resolve, 2000))
                    }
                    break
                }
                case "lazygit": {
                    ensureTool("ansi-recolor")
                    ensureTool("git")
                    ensureTool("lazygit")
                    ensureTool("vim")
                    const env: Env = { ...process.env as Env, TERM: "xterm-color" }
                    await execInherit("ansi-recolor", [
                        "-c", path.join(basedir, "ansi-recolor.conf"),
                        "-m",
                        "-n", "lazygit",
                        "-t", path.join(HOME, "ansi-recolor.txt"),
                        "lazygit", "-ucf", path.join(basedir, "lazygit.yaml"),
                        ...argv
                    ], { env })
                    break
                }
                default:
                    fatal(`invalid util "${util ?? ""}"`)
            }
            break
        }

        default:
            fatal(`invalid command "${cmd}"`)
    }
}
main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    fatal(msg)
})

