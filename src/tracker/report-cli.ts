// `ghostcode report` — reads tracker JSONL files and prints table or CSV.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TRACKER_DIR } from "./log.ts";
import { aggregateEvents, formatTable, toCsv } from "./report.ts";

export function runReport(argv: string[]): number {
  const days = argv.includes("--day") ? 1 : argv.includes("--month") ? 31 : 7;
  const csv = argv.includes("--csv");
  const pIdx = argv.indexOf("--project");
  const projectFilter = pIdx !== -1 ? argv[pIdx + 1] : null;

  if (!existsSync(TRACKER_DIR)) {
    process.stdout.write("no tracked work yet — toggle tracking with W on a project\n");
    return 0;
  }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const lines: string[] = [];
  for (const f of readdirSync(TRACKER_DIR).sort()) {
    const m = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (!m || m[1] < cutoff) continue;
    lines.push(...readFileSync(join(TRACKER_DIR, f), "utf8").split("\n").filter(Boolean));
  }
  let rows = aggregateEvents(lines);
  if (projectFilter) rows = rows.filter((r) => r.project === projectFilter);
  process.stdout.write(csv ? toCsv(rows) : formatTable(rows));
  return 0;
}
