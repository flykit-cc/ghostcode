import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// VS Code is optional. We auto-detect so the dashboard doesn't show a control
// that would be a no-op (or worse, confuse the user) on machines without it.
// Config can force it on/off via ~/.config/ghostcode/config.json:
//   { "showVSCodeOption": "auto" | "on" | "off" }
export function detectVSCode(): boolean {
  if (existsSync("/Applications/Visual Studio Code.app")) return true;
  const r = spawnSync("command", ["-v", "code"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return true;
  const r2 = spawnSync("which", ["code"], { encoding: "utf8" });
  return r2.status === 0 && !!r2.stdout.trim();
}
