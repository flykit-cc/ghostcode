import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { ACCENT, SELECTION_BG } from "./theme.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };

const STATE_PATH = join(homedir(), ".config/ghostcode/state.json");
const REPO = "github.com/flykit-cc/ghostcode";

export type SettingsAction =
  | "reports"
  | "projectRoots"
  | "apiKeys"
  | "clearRecents"
  | "clearFavorites"
  | "clearTints"
  | "rerunSetup"
  | "resetAll"
  | "back";

type Counts = {
  recents: number;
  favorites: number;
  tints: number;
  apiKeys: number;
};

type Props = {
  roots: string[];
  counts: Counts;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onAction: (action: SettingsAction, currentIndex: number) => void;
  onCancel: () => void;
};

type Item = {
  id: SettingsAction;
  label: string;
  sublabel?: string;
};

export function SettingsScreen({
  roots,
  counts,
  initialIndex,
  onIndexChange,
  onAction,
  onCancel,
}: Props) {
  const items: Item[] = [
    {
      id: "reports",
      label: "Work reports",
      sublabel: "time + tokens per project",
    },
    {
      id: "projectRoots",
      label: "Project roots",
      sublabel: `${roots.length} root${roots.length === 1 ? "" : "s"}`,
    },
    {
      id: "apiKeys",
      label: "API keys",
      sublabel:
        counts.apiKeys > 0
          ? `${counts.apiKeys} set`
          : "none set",
    },
    {
      id: "clearRecents",
      label: "Clear recent projects",
      sublabel:
        counts.recents > 0 ? `${counts.recents} tracked` : "nothing to clear",
    },
    {
      id: "clearFavorites",
      label: "Clear favorites",
      sublabel:
        counts.favorites > 0
          ? `${counts.favorites} starred`
          : "nothing to clear",
    },
    {
      id: "clearTints",
      label: "Clear tint colors",
      sublabel:
        counts.tints > 0 ? `${counts.tints} tinted` : "nothing to clear",
    },
    {
      id: "rerunSetup",
      label: "Re-run setup wizard",
      sublabel: "reconfigure on next Ghostty open",
    },
    {
      id: "resetAll",
      label: "Reset all state",
      sublabel: "wipes recents, favorites, tints, per-project settings",
    },
    { id: "back", label: "← Back to dashboard" },
  ];

  const [index, setIndex] = useState(() => {
    const i = initialIndex ?? 0;
    return Math.min(Math.max(0, i), items.length - 1);
  });
  const update = (next: number) => {
    setIndex(next);
    onIndexChange?.(next);
  };

  useInput((_input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const pick = items[index];
      if (pick) onAction(pick.id, index);
      return;
    }
    if (key.upArrow) return update(Math.max(0, index - 1));
    if (key.downArrow) return update(Math.min(items.length - 1, index + 1));
  });

  // Two-column layout matching ListPicker.
  const maxLabelLen = Math.max(...items.map((it) => it.label.length));
  const maxSubLen = Math.max(
    0,
    ...items.map((it) => (it.sublabel ? it.sublabel.length : 0)),
  );

  return (
    <Box flexDirection="column">
      <Header title="Settings" />
      {items.map((it, i) => {
        const active = i === index;
        const danger = it.id === "resetAll";
        const bg = active ? (danger ? "red" : SELECTION_BG) : undefined;
        return (
          <Box key={it.id}>
            <Text backgroundColor={bg} color={ACCENT} bold={active}>
              {` ${active ? "▸" : " "}  `}
            </Text>
            <Text
              backgroundColor={bg}
              color={active ? "white" : danger ? "red" : undefined}
              bold={active}
            >
              {it.label.padEnd(maxLabelLen)}
            </Text>
            <Text
              backgroundColor={bg}
              color={active ? "white" : undefined}
              dimColor
            >
              {`  ${(it.sublabel ?? "").padEnd(maxSubLen)}  `}
            </Text>
          </Box>
        );
      })}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          {"   state:  " + STATE_PATH.replace(homedir(), "~")}
        </Text>
        <Text dimColor>
          {pkg.name} v{pkg.version} · MIT · {REPO}
        </Text>
        <Text dimColor>
          Not affiliated with Anthropic or Ghostty. No telemetry.
        </Text>
      </Box>
      <Footer hint="↑↓ · ⏎ select · esc back" />
    </Box>
  );
}
