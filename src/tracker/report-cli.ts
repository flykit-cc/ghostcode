// `ghostcode report` — reads tracker JSONL files and prints table or CSV.
import { existsSync } from "node:fs";
import { TRACKER_DIR, readEventLines } from "./log.ts";
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
  const lines = readEventLines(days);
  let rows = aggregateEvents(lines);
  if (projectFilter) rows = rows.filter((r) => r.project === projectFilter);
  process.stdout.write(csv ? toCsv(rows) : formatTable(rows));
  return 0;
}
