#!/bin/zsh
# Ghostty calls this. Loads your shell env, runs first-run setup if needed,
# then starts the precompiled launcher via Node.

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

# ── Node dispatch ──────────────────────────────────────────────────────
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  print -P "%F{red}ghostcode:%f node not found. Install via: brew install node"
  exec zsh
fi

exec "$NODE" "$SCRIPT_DIR/dist/ghostcode.js" "$@"
