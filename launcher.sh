#!/bin/zsh
# Ghostty calls this. Loads your shell env, runs first-run setup if needed,
# syncs the Ghostty app icon, then starts the precompiled launcher via Node.

SCRIPT_DIR="${0:A:h}"

[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# ── Ghostty-only guard ────────────────────────────────────────────────
if [ ! -d "/Applications/Ghostty.app" ]; then
  print -P "%F{red}ghostcode only runs inside Ghostty.%f"
  echo "Install Ghostty (https://ghostty.org) and the setup wizard will wire it up."
  exit 1
fi

# ── First-run setup ────────────────────────────────────────────────────
SETUP_MARKER="$HOME/.config/ghostcode/.setup-complete"
if [ ! -f "$SETUP_MARKER" ]; then
  "$SCRIPT_DIR/scripts/init.sh" || exit 1
fi

# ── Claude Code pre-flight ─────────────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  print -P "%F{yellow}claude not found.%f Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code || {
    print -P "%F{red}Install failed.%f Run: npm i -g @anthropic-ai/claude-code"
    exec zsh
  }
fi

# ── Icon sync (self-healing) ───────────────────────────────────────────
(
  ICON_PNG="$SCRIPT_DIR/assets/ghostcode-icon.png"
  ICON_HASH_FILE="$HOME/.config/ghostcode/.icon-hash"
  GHOSTTY_APP="/Applications/Ghostty.app"
  ICON_SIDECAR="$GHOSTTY_APP/Icon\r"

  [ -f "$ICON_PNG" ] || exit 0
  [ -d "$GHOSTTY_APP" ] || exit 0
  command -v fileicon >/dev/null 2>&1 || exit 0
  command -v shasum >/dev/null 2>&1 || exit 0

  NEW_HASH=$(shasum "$ICON_PNG" 2>/dev/null | awk '{print $1}')
  [ -n "$NEW_HASH" ] || exit 0
  OLD_HASH=$(cat "$ICON_HASH_FILE" 2>/dev/null || true)

  # Skip only when PNG hash matches AND the Ghostty sidecar icon is still present.
  # A Ghostty upgrade wipes the sidecar; re-apply in that case.
  if [ "$NEW_HASH" = "$OLD_HASH" ] && [ -e "$ICON_SIDECAR" ]; then
    exit 0
  fi

  mkdir -p "$(dirname "$ICON_HASH_FILE")"
  if fileicon set "$GHOSTTY_APP" "$ICON_PNG" >/dev/null 2>&1; then
    echo "$NEW_HASH" > "$ICON_HASH_FILE"
    touch "$GHOSTTY_APP"
    killall Dock 2>/dev/null
    killall Finder 2>/dev/null
  fi
) &

# ── Node dispatch ──────────────────────────────────────────────────────
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  print -P "%F{red}ghostcode:%f node not found. Install via: brew install node"
  exec zsh
fi

exec "$NODE" "$SCRIPT_DIR/dist/ghostcode.js"
