// Aggregates tracker JSONL events into per-day, per-project report rows.
import { basename } from "node:path";
import type { TurnTokens } from "./usage.ts";

export type ReportRow = {
  date: string;
  project: string;
  attendedMs: number;
  agentMs: number;
  sessions: number;
  tokens: TurnTokens;
};

type Ev = {
  ts: string;
  event: string;
  session_id: string;
  project: string;
  tokens?: TurnTokens;
  attended_ms?: number;
  agent_ms?: number;
};

export function aggregateEvents(lines: string[]): ReportRow[] {
  const events: Ev[] = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (o && o.event && o.session_id && o.project) events.push(o);
    } catch {}
  }

  type Sess = {
    date: string;
    project: string;
    total: { attended: number; agent: number } | null;
    lastPrompt: number | null;
    spanMs: number;
    tokens: TurnTokens;
  };
  const sessions = new Map<string, Sess>();
  for (const e of events) {
    let s = sessions.get(e.session_id);
    if (!s) {
      s = {
        date: e.ts.slice(0, 10),
        project: basename(e.project),
        total: null,
        lastPrompt: null,
        spanMs: 0,
        tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      };
      sessions.set(e.session_id, s);
    }
    const t = Date.parse(e.ts);
    if (e.event === "prompt") s.lastPrompt = t;
    if (e.event === "stop") {
      if (s.lastPrompt !== null) {
        s.spanMs += t - s.lastPrompt;
        s.lastPrompt = null;
      }
      if (e.tokens) {
        s.tokens.input += e.tokens.input;
        s.tokens.output += e.tokens.output;
        s.tokens.cache_read += e.tokens.cache_read;
        s.tokens.cache_write += e.tokens.cache_write;
      }
    }
    if (e.event === "session_total") {
      s.total = { attended: e.attended_ms ?? 0, agent: e.agent_ms ?? 0 };
    }
  }

  const byKey = new Map<string, ReportRow>();
  for (const s of sessions.values()) {
    const key = `${s.date} ${s.project}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        date: s.date,
        project: s.project,
        attendedMs: 0,
        agentMs: 0,
        sessions: 0,
        tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      };
      byKey.set(key, row);
    }
    const attended = s.total ? s.total.attended : s.spanMs;
    const agent = s.total ? s.total.agent : s.spanMs;
    row.attendedMs += attended;
    row.agentMs += agent;
    row.sessions += 1;
    row.tokens.input += s.tokens.input;
    row.tokens.output += s.tokens.output;
    row.tokens.cache_read += s.tokens.cache_read;
    row.tokens.cache_write += s.tokens.cache_write;
  }

  return [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project),
  );
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

const fmtTok = (n: number) =>
  n >= 1_000_000
    ? (n / 1_000_000).toFixed(1) + "M"
    : n >= 1000
      ? (n / 1000).toFixed(1) + "K"
      : String(n);

export function formatTable(rows: ReportRow[]): string {
  if (rows.length === 0) return "no tracked work in range\n";
  const header = ["date", "project", "attended", "agent", "sess", "in", "out", "cached"];
  const data = rows.map((r) => [
    r.date,
    r.project,
    fmtDuration(r.attendedMs),
    fmtDuration(r.agentMs),
    String(r.sessions),
    fmtTok(r.tokens.input),
    fmtTok(r.tokens.output),
    fmtTok(r.tokens.cache_read),
  ]);
  const totals = rows.reduce(
    (acc, r) => ({
      attended: acc.attended + r.attendedMs,
      agent: acc.agent + r.agentMs,
      sessions: acc.sessions + r.sessions,
    }),
    { attended: 0, agent: 0, sessions: 0 },
  );
  data.push([
    "total",
    "",
    fmtDuration(totals.attended),
    fmtDuration(totals.agent),
    String(totals.sessions),
    "",
    "",
    "",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(header), ...data.map(line)].join("\n") + "\n";
}

export function toCsv(rows: ReportRow[]): string {
  const header =
    "date,project,attended_min,agent_min,sessions,input_tok,output_tok,cache_read_tok,cache_write_tok";
  const body = rows.map((r) =>
    [
      r.date,
      r.project,
      Math.round(r.attendedMs / 60_000),
      Math.round(r.agentMs / 60_000),
      r.sessions,
      r.tokens.input,
      r.tokens.output,
      r.tokens.cache_read,
      r.tokens.cache_write,
    ].join(","),
  );
  return [header, ...body].join("\n") + "\n";
}
