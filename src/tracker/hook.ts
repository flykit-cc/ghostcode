// CC hook entrypoint. Reads the hook JSON from stdin, appends a tracker
// event, and (on SessionStart) spawns the per-session watcher. Must never
// block or fail a CC session: 2s watchdog, always exit 0.
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, debugLog, isTracked } from "./log.ts";
import { parseLastUsage, readTranscriptTail } from "./usage.ts";

setTimeout(() => process.exit(0), 2000).unref();

const EVENT_MAP: Record<string, string> = {
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "prompt",
  Stop: "stop",
};

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = input.cwd || process.cwd();
  // Fast path: ghostcode launches CC at the repo root, so cwd usually IS the
  // tracked key — skip the git subprocess when it matches directly.
  let root = cwd;
  if (!isTracked(root)) {
    try {
      root =
        execSync("git rev-parse --show-toplevel", {
          cwd,
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1500,
        })
          .toString()
          .trim() || cwd;
    } catch {}
  }

  if (isTracked(root)) {
    const event = EVENT_MAP[input.hook_event_name];
    if (event) {
      const rec: Record<string, unknown> = {
        event,
        session_id: input.session_id,
        project: root,
      };
      if (event === "stop" && input.transcript_path) {
        const tokens = parseLastUsage(readTranscriptTail(input.transcript_path));
        if (tokens) rec.tokens = tokens;
      }
      appendEvent(rec);

      if (event === "session_start") {
        const watcher = join(dirname(fileURLToPath(import.meta.url)), "tracker-watcher.js");
        spawn(
          process.execPath,
          [watcher, input.session_id, root, input.transcript_path || "", String(process.ppid)],
          { detached: true, stdio: "ignore" },
        ).unref();
      }
    }
  }
} catch (e) {
  debugLog(`hook error: ${e}`);
}
process.exit(0);
