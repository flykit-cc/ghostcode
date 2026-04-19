#!/bin/zsh
# GhostCode → Claude Code statusline bridge.
# Looks up the per-project tint color in ~/.config/ghostcode/state.json
# and renders the project name as a colored pill. Uses node (always present)
# instead of jq.

STATE="$HOME/.config/ghostcode/state.json"

INPUT="$(cat 2>/dev/null || true)"

# Resolve cwd from CC stdin if available, else $PWD.
CWD=""
if [ -n "$INPUT" ] && command -v node >/dev/null 2>&1; then
  CWD=$(printf '%s' "$INPUT" | node -e '
    let s="";process.stdin.on("data",d=>s+=d);
    process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.cwd||j.workspace?.current_dir||"");}catch{}});
  ' 2>/dev/null)
fi
[ -z "$CWD" ] && CWD="$PWD"
PROJECT="$(basename "$CWD")"

COLOR=""
if [ -f "$STATE" ] && command -v node >/dev/null 2>&1; then
  COLOR=$(node -e "
    try {
      const s=require('fs').readFileSync('$STATE','utf8');
      const j=JSON.parse(s);
      const c=(j.perProject||{})[process.argv[1]]?.color||'';
      process.stdout.write(c);
    } catch {}
  " "$CWD" 2>/dev/null)
fi

if [ -n "$COLOR" ] && [[ "$COLOR" =~ ^#[0-9a-fA-F]{6}$ ]]; then
  HEX="${COLOR#\#}"
  R=$((16#${HEX[1,2]}))
  G=$((16#${HEX[3,4]}))
  B=$((16#${HEX[5,6]}))
  printf "\e[48;2;%d;%d;%dm\e[97m %s \e[0m" "$R" "$G" "$B" "$PROJECT"
else
  printf "%s" "$PROJECT"
fi
