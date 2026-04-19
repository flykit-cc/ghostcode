# GhostCode

> **For everyone who loves Claude Code and wishes it remembered their setup.**
> Swap models on a whim, tint your projects so Monday-you remembers what Friday-you was doing, and spin up ten pre-configured terminals in a row — without re-picking anything. Hit Enter twice. Work starts.

A Ghostty launcher for Claude Code. Part of [flykit.cc](https://flykit.cc).

## Features

- **Fuzzy project picker** — type a few chars, starred favorites pinned on top, auto-tracked recents below
- **Per-project tints** — press `⇧C` to cycle a color; it follows the project into CC's statusline too
- **Model, effort, mode, provider** — all visible on the Dashboard, saved per-project and globally
- **Providers beyond Claude** — Anthropic API, GLM (Z.ai), Kimi (Moonshot), Qwen (DashScope), plus whatever you add
- **First-run wizard** — installs Homebrew packages + Claude Code, wires Ghostty config, wires the CC statusline, applies a custom app icon. Every step optional.
- **`claude update` on every launch** — always ships you the latest

## Install

Requires macOS. The wizard handles the rest on first run.

```bash
# Clone wherever — paths are self-resolving.
git clone https://github.com/flykit-cc/ghostcode.git ~/Documents/GitHub/ghostcode

# Point Ghostty at the launcher (the wizard offers to do this for you):
#   command = ~/Documents/GitHub/ghostcode/launcher.sh

# Open Ghostty. The first-run wizard launches automatically.
```

## Health check

```bash
~/Documents/GitHub/ghostcode/scripts/doctor.sh
```

Non-interactive, read-only. Status of every dep, config, wiring point. Exit 0 if everything passes. Run it whenever something feels off.

## What GhostCode modifies on your system

| Location | When | Reversible? |
|---|---|---|
| `~/.config/ghostcode/` | Always — state, config, setup marker, icon hash | `rm -rf ~/.config/ghostcode` |
| Ghostty config | Only if you accept during setup — appends a `command =` line | Remove the line manually |
| `~/.claude/settings.json` | Only if you accept CC statusline wiring — sets `statusLine` | Delete the `statusLine` key |
| `/Applications/Ghostty.app` icon | Only if you accept icon apply — via [`fileicon`](https://github.com/mklement0/fileicon) (Finder sidecar icon; does NOT modify the app bundle or break code signing) | `scripts/set-icon.sh clear` |
| macOS Keychain (items under account `ghostcode`) | Only when you store non-OAuth provider API keys | Keychain Access → delete entries |

No telemetry. No network calls beyond `claude update`, `brew`, and `npm` — all gated behind wizard prompts. State is local-only.

## Uninstall

```bash
~/Documents/GitHub/ghostcode/scripts/set-icon.sh clear   # restore Ghostty icon
rm -rf ~/Documents/GitHub/ghostcode
rm -rf ~/.config/ghostcode
# Remove the `command = …/ghostcode/launcher.sh` line from your Ghostty config
# Remove the `statusLine` key from ~/.claude/settings.json if added
```

## Disclaimers

- **Not affiliated** with Anthropic (Claude, Claude Code) or Mitchell Hashimoto (Ghostty). *Claude*, *Claude Code*, *Anthropic*, and *Ghostty* are trademarks of their respective owners. GhostCode is an independent integration built for interoperability.
- **Licensed MIT** — see [LICENSE](LICENSE). Use at your own risk. No warranty.
- **Interactive system changes** — the setup wizard runs `brew install`, `npm install -g`, and writes to the config files listed above. Review `scripts/init.sh` before running if that's a concern.
- **API keys** for non-OAuth providers (Anthropic API, GLM, Kimi, Qwen) are stored in macOS Keychain under account `ghostcode`. Never committed, never logged.

## License

MIT. See [LICENSE](LICENSE).
