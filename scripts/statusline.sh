#!/bin/zsh
# GhostCode → Claude Code statusline bridge.
#
# Looks up the per-project tint color in ~/.config/ghostcode/state.json
# and renders the project name with that tint as a pill, matching the
# GhostCode UI. If no tint is set, falls back to plain text.
#
# Wire it up in ~/.claude/settings.json (the setup wizard does this for you):
#   "statusLine": {
#     "type": "command",
#     "command": "<absolute path to>/ghostcode/scripts/statusline.sh"
#   }
#
# Requires jq for JSON parsing (brew install jq). Silently degrades to
# plain project name if jq is missing or state.json is absent.

STATE="$HOME/.config/ghostcode/state.json"

# Claude Code feeds session metadata as JSON on stdin — read it to get cwd
# if available, else fall back to $PWD.
INPUT="$(cat 2>/dev/null || true)"
CWD=""
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // .workspace.current_dir // empty' 2>/dev/null)
fi
[ -z "$CWD" ] && CWD="$PWD"
PROJECT="$(basename "$CWD")"

COLOR=""
if [ -f "$STATE" ] && command -v jq >/dev/null 2>&1; then
  COLOR=$(jq -r --arg k "$CWD" '.perProject[$k].color // empty' "$STATE" 2>/dev/null)
fi

if [ -n "$COLOR" ] && [[ "$COLOR" =~ ^#[0-9a-fA-F]{6}$ ]]; then
  HEX="${COLOR#\#}"
  R=$((16#${HEX[1,2]}))
  G=$((16#${HEX[3,4]}))
  B=$((16#${HEX[5,6]}))
  # 24-bit bg + bright white fg + padded spaces → pill look.
  printf "\e[48;2;%d;%d;%dm\e[97m %s \e[0m" "$R" "$G" "$B" "$PROJECT"
else
  printf "%s" "$PROJECT"
fi
