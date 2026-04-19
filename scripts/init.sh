#!/bin/zsh
# GhostCode first-run setup wizard.
# Runs interactively on the first Ghostty open (launcher.sh detects a missing
# marker file and invokes this script). To re-run, delete:
#   ~/.config/ghostcode/.setup-complete
# or use the "Re-run setup" option in the GhostCode Settings screen.

set -u

# Self-resolve so paths work regardless of repo location.
SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

MARKER="$HOME/.config/ghostcode/.setup-complete"
CONFIG_DIR="$HOME/.config/ghostcode"
CONFIG="$CONFIG_DIR/config.json"
LAUNCHER_CMD="$REPO_ROOT/launcher.sh"
STATUSLINE_CMD="$SCRIPT_DIR/statusline.sh"
ICON_SCRIPT="$SCRIPT_DIR/set-icon.sh"
ICON_PNG="$REPO_ROOT/assets/ghostcode-icon.png"
GHOSTTY_CONF="$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
CC_SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$CONFIG_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"

# ── Bootstrap: brew + gum ──────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  cat <<'EOF'

  GhostCode needs Homebrew to install its dependencies.

  Install it with:
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  Then reopen this terminal.

EOF
  exit 1
fi

if ! command -v gum >/dev/null 2>&1; then
  echo "Installing gum (used for the setup prompts)..."
  brew install gum || { echo "gum install failed — aborting"; exit 1; }
fi

# ── Helpers ────────────────────────────────────────────────────────────
banner() {
  gum style \
    --border rounded --border-foreground 212 --padding "1 2" --margin "1 0" \
    --align center --width 60 \
    "GhostCode setup" "Ghostty × Claude Code · first-run wizard"
}

section() {
  gum style --foreground 212 --bold "› $1"
}

ok() { gum style --foreground 46 "  ✓ $1"; }
skip() { gum style --faint "  ∘ $1"; }

# Install if missing, using a brew recipe. $1 = command, $2 = brew args, $3 = label.
install_if_missing() {
  local cmd="$1" args="$2" label="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$label already installed"
    return 0
  fi
  if gum confirm "$label is not installed. Install via brew?"; then
    # shellcheck disable=SC2086
    brew install $args && ok "$label installed" || skip "$label install failed"
  else
    skip "$label skipped"
  fi
}

banner

# ── Pre-flight: disclose what setup will touch ─────────────────────────
gum style --foreground 212 --bold "What this wizard will do"
cat <<'EOF'
  • Check and (with your consent) install: Homebrew packages
    (Ghostty, jq, fileicon, gum, bun), and Claude Code via npm
  • Write ~/.config/ghostcode/config.json (project search dirs)
  • Append a `command = …launcher.sh` line to Ghostty's config
  • Wire ~/.claude/settings.json to show project tints in the CC statusline
  • Optionally apply a custom icon to /Applications/Ghostty.app
    (via fileicon — does NOT modify the app bundle or break code signing)

  GhostCode is MIT-licensed. No telemetry. Not affiliated with Anthropic
  or Mitchell Hashimoto. Source: github.com/flykit-cc/ghostcode

  Every step below is individually skippable.
EOF

if ! gum confirm "Continue?"; then
  echo "Setup cancelled. Re-run anytime from Settings or delete $MARKER"
  exit 0
fi

# ── Step 1: dependencies ───────────────────────────────────────────────
section "Checking dependencies"

if [ -d "/Applications/Ghostty.app" ]; then
  ok "Ghostty already installed"
else
  if gum confirm "Ghostty is not installed. Install via brew cask?"; then
    brew install --cask ghostty && ok "Ghostty installed" || skip "Ghostty install failed"
  else
    skip "Ghostty skipped (launcher needs Ghostty to be useful)"
  fi
fi

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code already installed"
else
  if gum confirm "Claude Code is not installed. Install now (via npm)?"; then
    # npm ships with Node — if node is absent, install that first.
    command -v npm >/dev/null 2>&1 || brew install node
    npm install -g @anthropic-ai/claude-code && ok "Claude Code installed" \
      || skip "Claude Code install failed"
  else
    skip "Claude Code skipped"
  fi
fi

install_if_missing jq jq "jq (for CC statusline tint lookup)"
install_if_missing fileicon fileicon "fileicon (for custom Ghostty icon)"

if command -v bun >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then
  ok "bun already installed"
else
  if gum confirm "bun is not installed (required to run GhostCode). Install?"; then
    curl -fsSL https://bun.sh/install | bash && ok "bun installed" \
      || skip "bun install failed"
    export PATH="$HOME/.bun/bin:$PATH"
  else
    skip "bun skipped (GhostCode won't run without it)"
  fi
fi

# ── Step 2: project search directories ─────────────────────────────────
section "Project search directories"

DEFAULT_DIRS='~/Documents/GitHub
~/Sandbox'

if [ -f "$CONFIG" ]; then
  ok "Config exists at $CONFIG — skipping"
else
  echo "Default search dirs:"
  echo "$DEFAULT_DIRS" | sed 's/^/  /'
  if gum confirm "Use these defaults? (choose No to customize)"; then
    DIRS="$DEFAULT_DIRS"
  else
    DIRS=$(gum write \
      --header "One directory per line · ~ expands to home · Ctrl+D to save" \
      --placeholder "$DEFAULT_DIRS" \
      --height 8)
    [ -z "$DIRS" ] && DIRS="$DEFAULT_DIRS"
  fi
  # Convert to JSON array via python (always present on macOS).
  python3 - "$DIRS" > "$CONFIG" <<'PY'
import json, sys
lines = [l.strip() for l in sys.argv[1].splitlines() if l.strip()]
print(json.dumps({"projectRoots": lines}, indent=2))
PY
  ok "Wrote $CONFIG"
fi

# ── Step 3: Ghostty config ─────────────────────────────────────────────
section "Ghostty configuration"

if [ -f "$GHOSTTY_CONF" ] && grep -q "ghostcode/launcher.sh" "$GHOSTTY_CONF"; then
  ok "Ghostty already launches GhostCode"
elif [ -d "/Applications/Ghostty.app" ]; then
  if gum confirm "Configure Ghostty to run GhostCode on startup?"; then
    mkdir -p "$(dirname "$GHOSTTY_CONF")"
    touch "$GHOSTTY_CONF"
    # Strip any previous `command =` line so we don't stack entries.
    tmp=$(mktemp)
    grep -v '^command = ' "$GHOSTTY_CONF" > "$tmp" && mv "$tmp" "$GHOSTTY_CONF"
    printf '\n# Added by GhostCode setup\ncommand = %s\n' "$LAUNCHER_CMD" >> "$GHOSTTY_CONF"
    ok "Wrote Ghostty startup command"
  else
    skip "Ghostty config skipped"
  fi
else
  skip "Ghostty not installed — config skipped"
fi

# ── Step 4: Claude Code statusline ─────────────────────────────────────
section "Claude Code statusline (project tint pill)"

if command -v claude >/dev/null 2>&1; then
  if [ -f "$CC_SETTINGS" ] && grep -q "ghostcode/scripts/statusline.sh" "$CC_SETTINGS"; then
    ok "CC statusline already wired to GhostCode"
  else
    if gum confirm "Wire CC statusline to show GhostCode project tints?"; then
      mkdir -p "$(dirname "$CC_SETTINGS")"
      if [ -f "$CC_SETTINGS" ] && command -v jq >/dev/null 2>&1; then
        tmp=$(mktemp)
        jq --arg cmd "$STATUSLINE_CMD" '.statusLine = {type: "command", command: $cmd}' \
          "$CC_SETTINGS" > "$tmp" && mv "$tmp" "$CC_SETTINGS"
      else
        # Fresh settings file or jq unavailable — simple write.
        cat > "$CC_SETTINGS" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "$STATUSLINE_CMD"
  }
}
EOF
      fi
      ok "Wrote CC statusline config"
    else
      skip "CC statusline skipped"
    fi
  fi
else
  skip "Claude Code not installed — statusline skipped"
fi

# ── Step 5: Ghostty app icon ───────────────────────────────────────────
section "Ghostty app icon"

if [ -f "$ICON_PNG" ] && [ -d "/Applications/Ghostty.app" ] && command -v fileicon >/dev/null 2>&1; then
  if gum confirm "Apply the GhostCode icon to Ghostty.app?"; then
    "$ICON_SCRIPT" set && killall Dock 2>/dev/null || true
    ok "Icon applied"
  else
    skip "Icon skipped"
  fi
else
  skip "Icon skipped (needs PNG + fileicon + Ghostty.app)"
fi

# ── Done ───────────────────────────────────────────────────────────────
touch "$MARKER"
gum style \
  --border double --border-foreground 212 --padding "0 2" --margin "1 0" \
  --foreground 212 --bold \
  "✓ GhostCode setup complete"
gum style --faint "Launching GhostCode..."
sleep 1
