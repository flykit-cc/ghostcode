#!/bin/zsh
# GhostCode health check. Non-interactive, read-only — safe to run anytime.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

CONFIG_DIR="$HOME/.config/ghostcode"
CONFIG="$CONFIG_DIR/config.json"
STATE="$CONFIG_DIR/state.json"
MARKER="$CONFIG_DIR/.setup-complete"
ICON_HASH="$CONFIG_DIR/.icon-hash"
GHOSTTY_CONF="$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
CC_SETTINGS="$HOME/.claude/settings.json"
ICON_PNG="$REPO_ROOT/assets/ghostcode-icon.png"

VERSION=$(node -e "console.log(require('$REPO_ROOT/package.json').version)" 2>/dev/null || echo "?")

fails=0
ok()      { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn()    { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail()    { printf "  \033[31m✗\033[0m %s\n" "$1"; fails=$((fails + 1)); }
section() { printf "\n\033[1;35m%s\033[0m\n" "$1"; }

printf "\033[1;35mGhostCode v%s\033[0m — health check\n" "$VERSION"

# ── Dependencies ───────────────────────────────────────────────────────
section "Dependencies"
if command -v brew >/dev/null 2>&1; then ok "brew"; else fail "brew missing — https://brew.sh"; fi
if command -v node >/dev/null 2>&1; then ok "node ($(node --version))"; else fail "node missing — the launcher won't start"; fi
if [ -d "/Applications/Ghostty.app" ]; then ok "Ghostty.app"; else fail "Ghostty not installed — ghostcode refuses to launch"; fi
if command -v claude >/dev/null 2>&1; then ok "claude ($(claude --version 2>/dev/null | head -1))"; else warn "claude CLI missing — will auto-install on next launch"; fi
if command -v fileicon >/dev/null 2>&1; then ok "fileicon"; else warn "fileicon missing — custom Ghostty icon won't apply"; fi

# ── Files & config ─────────────────────────────────────────────────────
section "Config files"
[ -d "$CONFIG_DIR" ] && ok "$CONFIG_DIR exists" || warn "$CONFIG_DIR missing (first run?)"
if [ -f "$CONFIG" ]; then
  if node -e "JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))" 2>/dev/null; then
    roots=$(node -e "console.log((JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).projectRoots||[]).join(', '))" 2>/dev/null)
    ok "config.json valid · roots: ${roots:-<none>}"
  else
    fail "config.json present but invalid JSON"
  fi
else
  warn "config.json missing — will be created on first launch"
fi
if [ -f "$STATE" ]; then
  if node -e "JSON.parse(require('fs').readFileSync('$STATE','utf8'))" 2>/dev/null; then
    summary=$(node -e "
      const j=JSON.parse(require('fs').readFileSync('$STATE','utf8'));
      const tints=Object.values(j.perProject||{}).filter(v=>v&&v.color).length;
      console.log((j.recents||[]).length+' recents, '+(j.favorites||[]).length+' favorites, '+tints+' tints');
    " 2>/dev/null)
    ok "state.json valid · $summary"
  else
    fail "state.json invalid JSON"
  fi
else
  warn "state.json missing (no projects launched yet)"
fi
if [ -f "$MARKER" ]; then ok "setup marker present"; else warn "setup marker missing — wizard will run on next Ghostty open"; fi

# ── Wiring ─────────────────────────────────────────────────────────────
section "Wiring"
if [ -f "$GHOSTTY_CONF" ] && grep -q '^command = ghostcode$' "$GHOSTTY_CONF"; then
  ok "Ghostty runs GhostCode on startup"
else
  warn "Ghostty not configured to launch GhostCode — add: command = ghostcode"
fi
if [ -f "$CC_SETTINGS" ]; then
  if grep -q "ghostcode/scripts/statusline.sh" "$CC_SETTINGS"; then
    ok "CC statusline wired to GhostCode"
  else
    warn "CC settings present but statusline not wired"
  fi
else
  warn "~/.claude/settings.json missing — CC statusline skipped"
fi
if [ -f "$ICON_PNG" ]; then
  if [ -f "$ICON_HASH" ]; then
    ok "icon applied · hash $(cat "$ICON_HASH" | cut -c1-7)…"
  else
    warn "icon PNG present but not applied"
  fi
else
  warn "no icon PNG at assets/ghostcode-icon.png"
fi

# ── Summary ────────────────────────────────────────────────────────────
printf "\n"
if [ "$fails" -eq 0 ]; then
  printf "\033[1;32m✓ all critical checks passed\033[0m\n"
  exit 0
else
  printf "\033[1;31m✗ %d critical issue(s) found\033[0m — fix and re-run\n" "$fails"
  exit 1
fi
