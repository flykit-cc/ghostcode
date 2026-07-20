import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { ACCENT, SELECTION_BG } from "./theme.ts";
import { readEventLines } from "../tracker/log.ts";
import {
  aggregateEvents,
  fmtDuration,
  groupRows,
  type Grouping,
  type ReportRow,
} from "../tracker/report.ts";

type Props = { onDone: () => void };

type Range = { id: string; label: string; days: number };

const RANGES: Range[] = [
  { id: "day", label: "Today", days: 1 },
  { id: "week", label: "7 days", days: 7 },
  { id: "month", label: "31 days", days: 31 },
];

const BAR_WIDTH = 18;

const fmtTok = (n: number) =>
  n >= 1_000_000
    ? (n / 1_000_000).toFixed(1) + "M"
    : n >= 1000
      ? (n / 1000).toFixed(1) + "K"
      : String(n);

export function ReportScreen({ onDone }: Props) {
  const [rangeIdx, setRangeIdx] = useState(1); // default: 7 days
  const [grouping, setGrouping] = useState<Grouping>("project");
  const range = RANGES[rangeIdx];

  const rows: ReportRow[] = useMemo(
    () => groupRows(aggregateEvents(readEventLines(range.days)), grouping),
    [range.days, grouping],
  );

  useInput((input, key) => {
    if (key.escape) return onDone();
    if (key.leftArrow)
      return setRangeIdx((i) => (i === 0 ? RANGES.length - 1 : i - 1));
    if (key.rightArrow || key.tab)
      return setRangeIdx((i) => (i + 1) % RANGES.length);
    if (input === "g" || input === "G")
      return setGrouping((g) => (g === "project" ? "date" : "project"));
  });

  const totals = rows.reduce(
    (a, r) => ({
      attended: a.attended + r.attendedMs,
      agent: a.agent + r.agentMs,
      sessions: a.sessions + r.sessions,
      input: a.input + r.tokens.input,
      output: a.output + r.tokens.output,
    }),
    { attended: 0, agent: 0, sessions: 0, input: 0, output: 0 },
  );
  const peak = Math.max(1, ...rows.map((r) => r.attendedMs));
  const labelOf = (r: ReportRow) => (grouping === "project" ? r.project : r.date);
  const labelW = Math.max(7, ...rows.map((r) => labelOf(r).length));

  return (
    <Box flexDirection="column">
      <Header title="Reports" />

      {/* Range tabs — the selected one is highlighted, others dim. */}
      <Box paddingX={1}>
        {RANGES.map((r, i) => (
          <Text
            key={r.id}
            backgroundColor={i === rangeIdx ? SELECTION_BG : undefined}
            color={i === rangeIdx ? "white" : undefined}
            dimColor={i !== rangeIdx}
            bold={i === rangeIdx}
          >
            {`  ${r.label}  `}
          </Text>
        ))}
        <Text dimColor>{`   grouped by ${grouping}`}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 && (
          <Text dimColor>
            {"   no tracked work in this range — press W on a project to track it"}
          </Text>
        )}
        {rows.map((r) => {
          const filled = Math.round((r.attendedMs / peak) * BAR_WIDTH);
          return (
            <Box key={labelOf(r)}>
              <Text>{`  ${labelOf(r).padEnd(labelW)}  `}</Text>
              <Text color={ACCENT}>{"█".repeat(filled)}</Text>
              <Text dimColor>{"░".repeat(BAR_WIDTH - filled)}</Text>
              <Text>{`  ${fmtDuration(r.attendedMs).padStart(7)}`}</Text>
              <Text dimColor>{`  agent ${fmtDuration(r.agentMs).padStart(7)}`}</Text>
              <Text dimColor>{`  ${String(r.sessions).padStart(3)} sess`}</Text>
              <Text dimColor>
                {`  ↑${fmtTok(r.tokens.input)} ↓${fmtTok(r.tokens.output)}`}
              </Text>
            </Box>
          );
        })}
      </Box>

      {rows.length > 0 && (
        <Box marginTop={1} paddingX={1}>
          <Text bold>{`total  ${fmtDuration(totals.attended)}`}</Text>
          <Text dimColor>
            {`   agent ${fmtDuration(totals.agent)} · ${totals.sessions} sessions · ↑${fmtTok(totals.input)} ↓${fmtTok(totals.output)}`}
          </Text>
        </Box>
      )}

      <Footer hint="←→ range · G group by project/date · esc back" />
    </Box>
  );
}
