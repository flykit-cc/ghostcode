#!/bin/zsh
# Ghostty calls this. Loads your shell env, runs first-run setup if needed,
# syncs the Ghostty app icon, then starts the Ink launcher via Bun.

# Script self-resolves so the repo can live anywhere (~/Documents/GitHub/,
# npm global install, a symlink) — no paths are hardcoded to any home dir.
SCRIPT_DIR="${0:A:h}"

# Source zshrc safely: missing file or errors shouldn't abort the launcher.
# Explicit PATH fallback keeps things working on fresh machines.
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"

# ── First-run setup ────────────────────────────────────────────────────
SETUP_MARKER="$HOME/.config/ghostcode/.setup-complete"
if [ ! -f "$SETUP_MARKER" ]; then
  "$SCRIPT_DIR/scripts/init.sh" || true
fi

# Bun is required by the launcher. If missing, install before anything else.
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "Installing bun (required by GhostCode)..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# ── Icon sync ──────────────────────────────────────────────────────────
# Writes a hash file after a successful apply. On next launch, if the PNG
# hash is unchanged, we skip — so this is a no-op after first run. Any
# missing dep (fileicon, PNG, Ghostty.app) silently skips. Never blocks.
(
  ICON_PNG="$SCRIPT_DIR/assets/ghostcode-icon.png"
  ICON_HASH_FILE="$HOME/.config/ghostcode/.icon-hash"
  GHOSTTY_APP="/Applications/Ghostty.app"

  [ -f "$ICON_PNG" ] || exit 0
  [ -d "$GHOSTTY_APP" ] || exit 0
  command -v fileicon >/dev/null 2>&1 || exit 0
  command -v shasum >/dev/null 2>&1 || exit 0

  NEW_HASH=$(shasum "$ICON_PNG" 2>/dev/null | awk '{print $1}')
  [ -n "$NEW_HASH" ] || exit 0
  OLD_HASH=$(cat "$ICON_HASH_FILE" 2>/dev/null || true)
  [ "$NEW_HASH" = "$OLD_HASH" ] && exit 0

  mkdir -p "$(dirname "$ICON_HASH_FILE")"
  if fileicon set "$GHOSTTY_APP" "$ICON_PNG" >/dev/null 2>&1; then
    echo "$NEW_HASH" > "$ICON_HASH_FILE"
  fi
) &

# ── Bun dispatch ───────────────────────────────────────────────────────
BUN="$(command -v bun)"
[ -z "$BUN" ] && BUN="$HOME/.bun/bin/bun"

if [ ! -x "$BUN" ]; then
  print -P "%F{red}ghostcode:%f bun not found. Install: curl -fsSL https://bun.sh/install | bash"
  exec zsh
fi

exec "$BUN" run "$SCRIPT_DIR/src/index.tsx"
