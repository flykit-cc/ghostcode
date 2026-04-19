#!/bin/zsh
# GhostCode health check. Non-interactive, read-only — safe to run anytime.
# Reports on every dep, config, and wiring point in one pass so users can
# diagnose why something isn't working without firing up the Ink app.
#
# Exit 0 if everything is OK, 1 if any critical issue is found.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

CONFIG_DIR="$HOME/.config/ghostcode"
CONFIG="$CONFIG_DIR/config.json"
STATE="$CONFIG_DIR/state.json"
MARKER="$CONFIG_DIR/.setup-complete"
ICON_HASH="$CONFIG_DIR/.icon-hash"
LAUNCHER="$REPO_ROOT/launcher.sh"
STATUSLINE="$SCRIPT_DIR/statusline.sh"
GHOSTTY_CONF="$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
CC_SETTINGS="$HOME/.claude/settings.json"
ICON_PNG="$REPO_ROOT/assets/ghostcode-icon.png"

fails=0

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; fails=$((fails + 1)); }
section() { printf "\n\033[1;35m%s\033[0m\n" "$1"; }

printf "\033[1;35mGhostCode doctor\033[0m — health check\n"

# ── Dependencies ───────────────────────────────────────────────────────
section "Dependencies"

if command -v brew >/dev/null 2>&1; then ok "brew"; else fail "brew missing — https://brew.sh"; fi
if command -v bun >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then
  ok "bun ($(bun --version 2>/dev/null || "$HOME/.bun/bin/bun" --version 2>/dev/null))"
else
  fail "bun missing — the launcher won't start"
fi
if [ -d "/Applications/Ghostty.app" ]; then ok "Ghostty.app"; else warn "Ghostty not installed (launcher still usable from any terminal)"; fi
if command -v claude >/dev/null 2>&1; then
  ok "claude ($(claude --version 2>/dev/null | head -1))"
else
  fail "claude CLI missing — GhostCode can't launch sessions"
fi
if command -v jq >/dev/null 2>&1; then ok "jq"; else warn "jq missing — CC statusline tint won't resolve"; fi
if command -v fileicon >/dev/null 2>&1; then ok "fileicon"; else warn "fileicon missing — custom Ghostty icon unavailable"; fi
if command -v gum >/dev/null 2>&1; then ok "gum (setup wizard prompts)"; else warn "gum missing — setup wizard can't run"; fi

# ── Files & config ─────────────────────────────────────────────────────
section "Config files"

[ -d "$CONFIG_DIR" ] && ok "$CONFIG_DIR exists" || warn "$CONFIG_DIR missing (first run?)"

if [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1 && jq -e . "$CONFIG" >/dev/null 2>&1; then
    roots=$(jq -r '.projectRoots | join(", ")' "$CONFIG" 2>/dev/null)
    ok "config.json valid · roots: ${roots:-<none>}"
  elif jq -e . "$CONFIG" >/dev/null 2>&1 2>/dev/null; then
    ok "config.json present"
  else
    fail "config.json present but invalid JSON"
  fi
else
  warn "config.json missing — will be created on first setup"
fi

if [ -f "$STATE" ]; then
  if command -v jq >/dev/null 2>&1 && jq -e . "$STATE" >/dev/null 2>&1; then
    recents=$(jq -r '.recents | length' "$STATE" 2>/dev/null)
    favorites=$(jq -r '.favorites | length' "$STATE" 2>/dev/null)
    tints=$(jq -r '[.perProject[]? | select(.color)] | length' "$STATE" 2>/dev/null)
    ok "state.json valid · $recents recents, $favorites favorites, $tints tints"
  else
    fail "state.json invalid JSON"
  fi
else
  warn "state.json missing (no projects launched yet)"
fi

if [ -f "$MARKER" ]; then ok "setup marker present"; else warn "setup marker missing — wizard will run on next Ghostty open"; fi

# ── Wiring ─────────────────────────────────────────────────────────────
section "Wiring"

if [ -x "$LAUNCHER" ]; then ok "launcher.sh executable"; else fail "launcher.sh missing or not executable"; fi

if [ -f "$GHOSTTY_CONF" ] && grep -q "ghostcode/launcher.sh" "$GHOSTTY_CONF"; then
  ok "Ghostty runs GhostCode on startup"
else
  warn "Ghostty not configured to launch GhostCode — add: command = $LAUNCHER"
fi

if [ -f "$CC_SETTINGS" ]; then
  if grep -q "ghostcode/scripts/statusline.sh" "$CC_SETTINGS"; then
    ok "CC statusline wired to GhostCode"
  else
    warn "CC settings present but statusline not wired — tints won't show in CC"
  fi
else
  warn "~/.claude/settings.json missing — CC statusline skipped"
fi

if [ -f "$ICON_PNG" ]; then
  if [ -f "$ICON_HASH" ]; then
    ok "icon applied · hash $(cat "$ICON_HASH" | cut -c1-7)…"
  else
    warn "icon PNG present but not applied — run scripts/set-icon.sh set"
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
