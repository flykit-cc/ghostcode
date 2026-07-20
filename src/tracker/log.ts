// Data paths, opt-in check, and JSONL append helpers for the work tracker.
// Every function here is try/catch-safe: tracking must never break a session.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TRACKER_DIR = join(homedir(), ".config/ghostcode/tracker");

const pad = (n: number) => String(n).padStart(2, "0");

export function eventsPathFor(d: Date): string {
  return join(
    TRACKER_DIR,
    `events-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`,
  );
}

export function livePathFor(sessionId: string): string {
  return join(TRACKER_DIR, "live", `${sessionId}.json`);
}

export function appendEvent(obj: Record<string, unknown>): void {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true });
    const rec = { ts: new Date().toISOString(), ...obj };
    appendFileSync(eventsPathFor(new Date()), JSON.stringify(rec) + "\n");
  } catch {}
}

export function isTracked(projectRoot: string): boolean {
  try {
    const state = JSON.parse(
      readFileSync(join(homedir(), ".config/ghostcode/state.json"), "utf8"),
    );
    return (state.perProject || {})[projectRoot]?.track === true;
  } catch {
    return false;
  }
}

export function readTrackerConfig(): {
  presenceIdleSec: number;
  graceSec: number;
  audio: boolean;
} {
  const defaults = { presenceIdleSec: 180, graceSec: 60, audio: true };
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), ".config/ghostcode/config.json"), "utf8"),
    );
    return { ...defaults, ...(cfg.tracker || {}) };
  } catch {
    return defaults;
  }
}

/**
 * Event lines from the last `days` daily logs (today counts as day 1).
 * Shared by `ghostcode report` and the in-app Reports screen.
 */
export function readEventLines(days: number): string[] {
  try {
    if (!existsSync(TRACKER_DIR)) return [];
    const cutoff = new Date(Date.now() - (days - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const lines: string[] = [];
    for (const f of readdirSync(TRACKER_DIR).sort()) {
      const m = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (!m || m[1] < cutoff) continue;
      lines.push(
        ...readFileSync(join(TRACKER_DIR, f), "utf8").split("\n").filter(Boolean),
      );
    }
    return lines;
  } catch {
    return [];
  }
}

export function debugLog(msg: string): void {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true });
    const p = join(TRACKER_DIR, "debug.log");
    if (existsSync(p) && statSync(p).size > 1_000_000) writeFileSync(p, "");
    appendFileSync(p, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}
