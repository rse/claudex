#!/usr/bin/env bash
##
##  sc.bash -- Search Content
##  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
##  Licensed under MIT license <https://spdx.org/licenses/MIT>
##

#   determine command
cmd="main"
if [[ $# -ge 1 ]]; then
    case "$1" in
        search  ) cmd="search";  shift ;;
        preview ) cmd="preview"; shift ;;
        open    ) cmd="open";    shift ;;
        *       ) cmd="main"           ;;
    esac
fi

#   helper function for ensuring a tool is available
ensureTool () {
    local tool="$1"
    if ! which "$tool" >/dev/null 2>&1; then
        echo "sc: ERROR: necessary tool \"$tool\" not found"
        exit 1
    fi
}

#   dispatch according to command
if [[ $cmd == "main" ]]; then

    #   ==== MAIN ====

    #   ensure all necessary tools are available
    for tool in fzf rg bat; do
        ensureTool $tool
    done

    #   set the terminal title
    (echo -e -n "\033]1;Search Content\007") 2>/dev/null || true

    #   pass-through execution to fzf(1)
    exec fzf \
        --disabled \
        --delimiter "<1>" \
        --with-nth 3.. \
        --ansi \
        --color "light,bg:-1,fg:-1,hl:-1,bg+:15,fg+:0,hl+:1,gutter:-1,pointer:1,info:4,prompt:-1" \
        --info "inline-right:matches: " \
        --bind "start:reload:$0 search '{q}'" \
        --bind "change:reload:$0 search '{q}'" \
        --bind "enter:execute:$0 open vim {+f} {1} {2}" \
        --bind "ctrl-e:execute:$0 open vim {+f} {1} {2}" \
        --bind "ctrl-o:execute:$0 open vsc {+f} {1} {2}" \
        --bind "ctrl-k:kill-line" \
        --bind "ctrl-p:toggle-preview" \
        --preview "$0 preview {1} {2}" \
        --preview-window '~4,+{2}+4/3,<80(up)' \
        --multi \
        --query "$*"

elif [[ $cmd == "search" ]]; then

    #   ==== SEARCH ====

    #   in case of an empty query, return empty result set
    if [[ "$*" == "" ]]; then
        echo "(none)<1>(none)<1>(for help see preview)"
        exit 0
    fi

    #   convert query into a logical AND-based regular expression
    if [[ $# -eq 0 ]]; then
        exit 0
    elif [[ $# -ge 1 ]]; then
        query=""
        for arg in "$@"; do
            query="${query}(?=.*${arg}.*)"
        done
    fi

    #   sleep a short time for smoother display
    sleep 0.05

    #   search file content
    rg --pcre2 \
        --with-filename \
        --line-number \
        --no-column \
        --no-heading \
        --field-match-separator "<2>" \
        --color "always" \
        --colors "path:fg:blue" \
        --colors "line:fg:white" \
        --colors "column:fg:white" \
        --colors "match:fg:red" \
        --colors "match:style:nobold" \
        --smart-case \
        "$query" | \
        awk -F "<2>" '{
            file = $1; \
            line = $2; \
            text = substr($0, index($0, $3)); \
            raw_file = file; gsub(/\x1B\[[0-9;]*[A-Za-z]/, "", raw_file); \
            raw_line = line; gsub(/\x1B\[[0-9;]*[A-Za-z]/, "", raw_line); \
            printf "%s<1>%s<1>%s: %s: %s\n", raw_file, raw_line, file, line, text
        }'

    #   search file names
    rg --files | \
        rg --pcre2 \
        --no-line-number \
        --no-column \
        --no-heading \
        --field-match-separator "<2>" \
        --color "always" \
        --colors "match:fg:red" \
        --colors "match:style:nobold" \
        --smart-case \
        "$query" | \
        awk -F "<2>" 'BEGIN {
            red   = "\033[31m"
            blue  = "\033[34m"
            reset = "\033[0m"
        } {
            file = $1; \
            line = 1; \
            text = "[...]"; \
            raw_file = file; gsub(/\x1B\[[0-9;]*[A-Za-z]/, "", raw_file); \
            raw_line = line; gsub(/\x1B\[[0-9;]*[A-Za-z]/, "", raw_line); \
            gsub(/^/, blue, file); \
            gsub(/\x1B\[31m/, reset red, file); \
            gsub(/\x1B\[0m/, reset blue, file); \
            gsub(/$/, reset, file); \
            printf "%s<1>%s<1>%s: %s: %s\n", raw_file, raw_line, file, line, text
        }'

elif [[ $cmd == "preview" ]]; then

    #   ==== PREVIEW ====

    #   get parameters
    file=$(echo "$1" | sed -e 's;^ *;;' -e 's; *$;;')
    line="$2"

    #   short-circuit no preview situation
    if [[ "$file" == "" || "$file" == "(none)" ]]; then
        echo ""
        echo "Search Content"
        echo "=============="
        echo ""
        echo "sc(1) is a small GNU Bash script which provides the capability to"
        echo "interactively search content on the filesystem. It fuzzy matches query"
        echo "strings both in file contents and file names. sc(1) internally is based"
        echo "on the excellent Unix utilities fzf(1) for dialog control, rg(1) for"
        echo "content searching, and bat(1) for content previewing."
        echo ""
        echo "Enter your query strings below. They are AND-wise combined, i.e. the"
        echo "content has to match all of them in order to be displayed."
        echo ""
        echo "Use cursor keys up/down for selecting the files, press ENTER or CTRL-E"
        echo "for editing the currently selected file in vim(1) and afterwards return"
        echo "to sc(1), or CTRL-O for editing the currently selected file in Visual"
        echo "Studio Code (via code(1)) and afterwards return to sc(1)."
        echo ""
        echo "Alternatively, select more than one file with TAB and then use ENTER,"
        echo "CTRL-E or CTRL-O for editing all the currently selected files in vim(1)"
        echo "or Visual Studio Code."
        echo ""
        echo "At any time, use CTRL-P to toggle the preview of the file."
        echo "At any time, use CTRL-C or ESCAPE to exit the program."
        exit 0
    fi

    #   pass-through preview rendering to bat(1)
    exec bat \
        --style=full \
        --color=always \
        --highlight-line "$line" \
        "$file"

elif [[ $cmd == "open" ]]; then

    #   ==== OPEN ====

    #   get parameters
    editor="$1"
    files="$2"
    file="$3"
    line="$4"

    #   short-circuit processing no selection at all
    if [[ "$file" == "" || "$file" == "(none)" ]]; then
        exit 0
    fi

    #   ensure editor tool is available
    if [[ $editor == "vim" ]]; then
        ensureTool vim
    elif [[ $editor == "vsc" ]]; then
        ensureTool code
    fi

    #   dispatch according to selection mode of fzf(1)
    if [[ $FZF_SELECT_COUNT -eq 0 ]]; then
         if [[ $editor == "vim" ]]; then
             exec vim "$file" "+$line"
         elif [[ $editor == "vsc" ]]; then
             exec code -g "$file:$line"
         fi
    else
         if [[ $editor == "vim" ]]; then
             vim -O $(sed -e 's;<1>.*;;' <"$files")
         elif [[ $editor == "vsc" ]]; then
             while IFS="<1>" read -r file _ line _; do
                 line=$(echo "$line" | sed -e 's;^ *;;' -e 's; *$;;')
                 (code -g "$file:$line") </dev/null >/dev/null 2>&1 || true
             done <"$files"
         fi
    fi

fi

