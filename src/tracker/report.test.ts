import { describe, test, expect } from "bun:test";
import { aggregateEvents, fmtDuration, toCsv } from "./report.ts";

const P = "/Users/kaiomp/Documents/GitHub/ghostcode";
const ev = (o: object) => JSON.stringify(o);

describe("aggregateEvents", () => {
  test("prefers session_total, sums tokens from stops", () => {
    const rows = aggregateEvents([
      ev({ ts: "2026-07-19T10:00:00Z", event: "session_start", session_id: "a", project: P }),
      ev({ ts: "2026-07-19T10:00:05Z", event: "prompt", session_id: "a", project: P }),
      ev({ ts: "2026-07-19T10:02:05Z", event: "stop", session_id: "a", project: P,
           tokens: { input: 10, output: 100, cache_read: 500, cache_write: 20 } }),
      ev({ ts: "2026-07-19T10:30:00Z", event: "session_total", session_id: "a", project: P,
           attended_ms: 600_000, agent_ms: 120_000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-07-19", project: "ghostcode",
      attendedMs: 600_000, agentMs: 120_000, sessions: 1,
      tokens: { input: 10, output: 100, cache_read: 500, cache_write: 20 },
    });
  });

  test("crashed session (no total) falls back to prompt→stop spans", () => {
    const rows = aggregateEvents([
      ev({ ts: "2026-07-19T10:00:00Z", event: "prompt", session_id: "b", project: P }),
      ev({ ts: "2026-07-19T10:03:00Z", event: "stop", session_id: "b", project: P,
           tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 } }),
    ]);
    expect(rows[0].agentMs).toBe(180_000);
    expect(rows[0].attendedMs).toBe(180_000); // approximated as agent time
  });

  test("groups by date+project across sessions", () => {
    const rows = aggregateEvents([
      ev({ ts: "2026-07-19T10:00:00Z", event: "session_total", session_id: "a", project: P,
           attended_ms: 60_000, agent_ms: 30_000 }),
      ev({ ts: "2026-07-19T15:00:00Z", event: "session_total", session_id: "b", project: P,
           attended_ms: 60_000, agent_ms: 30_000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(2);
    expect(rows[0].attendedMs).toBe(120_000);
  });

  test("ignores malformed lines", () => {
    expect(aggregateEvents(["not json", ""])).toHaveLength(0);
  });
});

test("fmtDuration", () => {
  expect(fmtDuration(0)).toBe("0m");
  expect(fmtDuration(8 * 60_000)).toBe("8m");
  expect(fmtDuration(134 * 60_000)).toBe("2h 14m");
});

test("toCsv emits minutes and header", () => {
  const csv = toCsv([{
    date: "2026-07-19", project: "ghostcode", attendedMs: 600_000, agentMs: 120_000,
    sessions: 1, tokens: { input: 10, output: 100, cache_read: 500, cache_write: 20 },
  }]);
  expect(csv.split("\n")[0]).toBe(
    "date,project,attended_min,agent_min,sessions,input_tok,output_tok,cache_read_tok,cache_write_tok",
  );
  expect(csv.split("\n")[1]).toBe("2026-07-19,ghostcode,10,2,1,10,100,500,20");
});

test("same basename, different paths stay separate rows", () => {
  const rows = aggregateEvents([
    ev({ ts: "2026-07-19T10:00:00Z", event: "session_total", session_id: "x", project: "/work/acme/app",
         attended_ms: 60_000, agent_ms: 0 }),
    ev({ ts: "2026-07-19T11:00:00Z", event: "session_total", session_id: "y", project: "/side/hobby/app",
         attended_ms: 60_000, agent_ms: 0 }),
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0].attendedMs).toBe(60_000);
  expect(rows[1].attendedMs).toBe(60_000);
});
