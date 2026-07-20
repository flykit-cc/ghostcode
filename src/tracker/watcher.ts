// Per-session tracker daemon. Spawned by the hook on SessionStart with:
//   argv: sessionId projectRoot transcriptPath parentPid
// Polls presence every 2s, drives the state machine, plays countdown audio,
// maintains the live file for the statusline, and flushes session totals.
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { initialState, tick, type MachineState } from "./machine.ts";
import { appendEvent, debugLog, eventsPathFor, livePathFor, readTrackerConfig } from "./log.ts";

const [sessionId, projectRoot, , parentPidRaw] = process.argv.slice(2);
const parentPid = Number(parentPidRaw) || 0;
if (!sessionId || !projectRoot) process.exit(0);

const cfg = readTrackerConfig();
const livePath = livePathFor(sessionId);
const pidPath = livePath + ".pid";

// Singleton per session.
try {
  mkdirSync(dirname(livePath), { recursive: true });
  if (existsSync(pidPath)) {
    const old = Number(readFileSync(pidPath, "utf8"));
    try {
      process.kill(old, 0);
      process.exit(0);
    } catch {}
  }
  writeFileSync(pidPath, String(process.pid));
} catch (e) {
  debugLog(`watcher init: ${e}`);
}

let agentWorking = false;
let eventsOffset = -1; // -1 = read whole file on first pass
let eventsDay = "";

function pollEvents(): void {
  // Tail today's events file incrementally; track prompt/stop/session_end.
  try {
    const day = new Date().toISOString().slice(0, 10);
    const p = eventsPathFor(new Date());
    if (day !== eventsDay) {
      eventsDay = day;
      eventsOffset = -1;
    }
    if (!existsSync(p)) return;
    const size = statSync(p).size;
    if (eventsOffset === -1) eventsOffset = 0;
    if (size <= eventsOffset) return;
    const fd = openSync(p, "r");
    const buf = Buffer.alloc(size - eventsOffset);
    readSync(fd, buf, 0, buf.length, eventsOffset);
    closeSync(fd);
    eventsOffset = size;
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes(sessionId)) continue;
      try {
        const e = JSON.parse(line);
        if (e.session_id !== sessionId) continue;
        if (e.event === "prompt") agentWorking = true;
        if (e.event === "stop") agentWorking = false;
        if (e.event === "session_end") shutdown();
      } catch {}
    }
  } catch (e) {
    debugLog(`pollEvents: ${e}`);
  }
}

function frontmostIsGhostty(): boolean {
  try {
    const asn = execSync("lsappinfo front", { timeout: 1000 }).toString().trim();
    if (!asn) return false;
    const info = execFileSync("lsappinfo", ["info", "-only", "name", asn], {
      timeout: 1000,
    }).toString();
    return /ghostty/i.test(info);
  } catch {
    return false;
  }
}

// Per-session input idle: the kernel bumps a tty's atime on every keystroke
// typed into THAT terminal (same mechanism `w` uses), so with several Ghostty
// windows open, typing in one doesn't mark the others as attended. Falls back
// to the machine-wide HID idle timer when the CC process has no tty.
let ttyPath: string | null = null;
try {
  const tty = execFileSync("ps", ["-o", "tty=", "-p", String(parentPid)], {
    timeout: 1000,
  })
    .toString()
    .trim();
  if (tty && tty !== "??") ttyPath = `/dev/${tty}`;
} catch {}

function inputIdleSec(): number {
  if (ttyPath) {
    try {
      const atime = statSync(ttyPath).atimeMs;
      return Math.max(0, (Date.now() - atime) / 1000);
    } catch {
      ttyPath = null; // tty vanished — use the global fallback from now on
    }
  }
  try {
    const out = execSync(
      "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'",
      { timeout: 1000, shell: "/bin/sh" },
    )
      .toString()
      .trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function say(text: string): void {
  if (!cfg.audio) return;
  try {
    spawn("say", [text], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}
function chime(): void {
  if (!cfg.audio) return;
  try {
    spawn("afplay", ["/System/Library/Sounds/Submarine.aiff"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {}
}

let state: MachineState = initialState();
let done = false;

function shutdown(): void {
  if (done) return;
  done = true;
  try {
    appendEvent({
      event: "session_total",
      session_id: sessionId,
      project: projectRoot,
      attended_ms: Math.round(state.attendedMs),
      agent_ms: Math.round(state.agentMs),
    });
  } catch {}
  try {
    unlinkSync(livePath);
  } catch {}
  try {
    unlinkSync(pidPath);
  } catch {}
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

setInterval(() => {
  try {
    // Parent CC process gone → session over.
    if (parentPid) {
      try {
        process.kill(parentPid, 0);
      } catch {
        return shutdown();
      }
    }
    pollEvents();
    const r = tick(
      state,
      {
        now: Date.now(),
        agentWorking,
        frontmost: frontmostIsGhostty(),
        inputIdleSec: inputIdleSec(),
      },
      cfg,
    );
    state = r.state;
    if (r.effects.say) say(r.effects.say);
    if (r.effects.chime) chime();
    if (r.effects.becameIdle)
      appendEvent({ event: "idle_start", session_id: sessionId, project: projectRoot });
    if (r.effects.resumed)
      appendEvent({ event: "idle_end", session_id: sessionId, project: projectRoot });
    writeFileSync(
      livePath,
      JSON.stringify({
        state: state.phase,
        attended_ms: Math.round(state.attendedMs),
        agent_ms: Math.round(state.agentMs),
        updated: Date.now(),
      }),
    );
  } catch (e) {
    debugLog(`watcher tick: ${e}`);
  }
}, 2000);
