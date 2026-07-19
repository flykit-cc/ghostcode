// src/tracker/hook.ts
import { execSync, spawn } from "node:child_process";
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/tracker/log.ts
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var TRACKER_DIR = join(homedir(), ".config/ghostcode/tracker");
var pad = (n) => String(n).padStart(2, "0");
function eventsPathFor(d) {
  return join(TRACKER_DIR, `events-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`);
}
function appendEvent(obj) {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true });
    const rec = { ts: new Date().toISOString(), ...obj };
    appendFileSync(eventsPathFor(new Date), JSON.stringify(rec) + `
`);
  } catch {}
}
function isTracked(projectRoot) {
  try {
    const state = JSON.parse(readFileSync(join(homedir(), ".config/ghostcode/state.json"), "utf8"));
    return (state.perProject || {})[projectRoot]?.track === true;
  } catch {
    return false;
  }
}
function debugLog(msg) {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true });
    const p = join(TRACKER_DIR, "debug.log");
    if (existsSync(p) && statSync(p).size > 1e6)
      writeFileSync(p, "");
    appendFileSync(p, `${new Date().toISOString()} ${msg}
`);
  } catch {}
}

// src/tracker/usage.ts
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
var USAGE_RE = /"usage":\{(?:[^{}]|\{[^{}]*\})*\}/g;
function parseLastUsage(tail) {
  const matches = tail.match(USAGE_RE);
  if (!matches)
    return null;
  for (let i = matches.length - 1;i >= 0; i--) {
    const m = matches[i];
    if (!m.includes('"output_tokens"'))
      continue;
    const num = (key) => {
      const r = new RegExp(`"${key}":(\\d+)`).exec(m);
      return r ? +r[1] : 0;
    };
    return {
      input: num("input_tokens"),
      output: num("output_tokens"),
      cache_read: num("cache_read_input_tokens"),
      cache_write: num("cache_creation_input_tokens")
    };
  }
  return null;
}
function readTranscriptTail(transcriptPath, maxBytes = 256 * 1024) {
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, maxBytes);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

// src/tracker/hook.ts
setTimeout(() => process.exit(0), 2000).unref();
var EVENT_MAP = {
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "prompt",
  Stop: "stop"
};
try {
  const input = JSON.parse(readFileSync2(0, "utf8"));
  const cwd = input.cwd || process.cwd();
  let root = cwd;
  if (!isTracked(root)) {
    try {
      root = execSync("git rev-parse --show-toplevel", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500
      }).toString().trim() || cwd;
    } catch {}
  }
  if (isTracked(root)) {
    const event = EVENT_MAP[input.hook_event_name];
    if (event) {
      const rec = {
        event,
        session_id: input.session_id,
        project: root
      };
      if (event === "stop" && input.transcript_path) {
        const tokens = parseLastUsage(readTranscriptTail(input.transcript_path));
        if (tokens)
          rec.tokens = tokens;
      }
      appendEvent(rec);
      if (event === "session_start") {
        const watcher = join2(dirname(fileURLToPath(import.meta.url)), "tracker-watcher.js");
        spawn(process.execPath, [watcher, input.session_id, root, input.transcript_path || "", String(process.ppid)], { detached: true, stdio: "ignore" }).unref();
      }
    }
  }
} catch (e) {
  debugLog(`hook error: ${e}`);
}
process.exit(0);
