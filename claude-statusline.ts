#!/usr/bin/env node
/*
**  claudeX -- Claude Code eXtended
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under MIT <https://spdx.org/licenses/MIT>
*/

/*  built-in dependencies  */
import * as path     from "node:path"
import * as fs       from "node:fs"

/*  external dependencies  */
import { execaSync } from "execa"

/*  structure of JSON data provided by Claude Code  */
interface Data {
    workspace?:      { current_dir?: string }
    model?:          { display_name?: string }
    context_window?: { used_percentage?: number }
    cost?:           { total_cost_usd?: number, total_duration_ms?: number }
    effort?:         { level?: string }
    thinking?:       { enabled?: boolean }
    session_id?:     string
}

/*  process JSON data in stdin  */
let input = ""
process.stdin.on("data", (chunk) => {
    input += chunk
})
process.stdin.on("end", () => {
    /*  parse JSON data  */
    const data = JSON.parse(input) as Data

    /*  fetch information from data  */
    const dir       = path.basename(data.workspace?.current_dir ?? "")
    const model     = data.model?.display_name ?? ""
    const pct       = Math.floor(data.context_window?.used_percentage ?? 0)
    const effort    = data.effort?.level ?? "unknown"
    const thinking  = (data.thinking?.enabled ?? false) === true ? "yes" : "no"
    const sessionId = data.session_id ?? "unknown"

    /*  optionally determine ASE task id  */
    let taskId = process.env.ASE_TASK_ID ?? ""
    try {
        const r = execaSync("ase", [ "config", `--scope=session:${sessionId}`, "get", "task.id" ],
            { stdio: [ "ignore", "pipe", "ignore" ], reject: false })
        const out = r.stdout.trim()
        if (out !== "")
            taskId = out
    }
    catch (_e) {
    }

    /*  optionally determine terminal width  */
    let width = 0
    try {
        const tty = fs.openSync("/dev/tty", "r")
        const r = execaSync("tput", [ "cols" ],
            { stdio: [ tty, "pipe", "ignore" ], reject: false } as any)
        fs.closeSync(tty)
        width = parseInt((r.stdout ?? "").trim()) || 0
    }
    catch (_e) {
    }
    const narrow = width > 0 && width < 80

    /*  configure ANSI sequences  */
    const RESET   = "\x1b[0m"
    const BOLD    = "\x1b[1m"
    const BLACK   = "\x1b[30m"
    const BLUE    = "\x1b[34m"
    const YELLOW  = "\x1b[33m"
    const RED     = "\x1b[31m"

    /*  determine context bar information  */
    const barSize  = 20
    const barColor = pct >= 80 ? RED : pct >= 60 ? YELLOW : pct >= 40 ? BLUE : RESET
    const filled   = Math.round(pct / 100 * barSize)
    const bar      = "█".repeat(filled) + "░".repeat(barSize - filled)

    /*  generate output  */
    let output = ""
    output += `${BLUE}※ user: ${BOLD}${process.env.USER ?? "unknown"}${RESET} `
    output += `${RED}⚑ project: ${BOLD}${dir}${RESET} `
    if (taskId !== "")
        output += `${BLACK}◉ task: ${BOLD}${taskId}${RESET} `
    if (narrow)
        output += "\n"
    output += `⏻ session: ${BOLD}${sessionId}${RESET}\n`
    output += `⚙ model: ${BOLD}${model}${RESET} `
    output += `⚒ effort: ${BOLD}${effort}${RESET} `
    if (narrow)
        output += "\n"
    output += `⚛ thinking: ${BOLD}${thinking}${RESET} `
    output += `${barColor}◔ context: ${bar} ${pct}%${RESET}\n`

    /*  send output  */
    process.stdout.write(output)
})

