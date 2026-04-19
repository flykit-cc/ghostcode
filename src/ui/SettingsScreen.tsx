import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { homedir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };

const STATE_PATH = join(homedir(), ".config/ghostcode/state.json");
const REPO = "github.com/flykit-cc/ghostcode";

export type SettingsAction =
  | "projectRoots"
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
};

type Props = {
  roots: string[];
  counts: Counts;
  onAction: (action: SettingsAction) => void;
  onCancel: () => void;
};

type Item = {
  id: SettingsAction;
  label: string;
  sublabel?: string;
};

export function SettingsScreen({ roots, counts, onAction, onCancel }: Props) {
  const items: Item[] = [
    {
      id: "projectRoots",
      label: "Project roots",
      sublabel: `${roots.length} root${roots.length === 1 ? "" : "s"}`,
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

  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const pick = items[index];
      if (pick) onAction(pick.id);
      return;
    }
    if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow)
      return setIndex((i) => Math.min(items.length - 1, i + 1));
  });

  // Two-column layout matching ListPicker.
  const maxLabelLen = Math.max(...items.map((it) => it.label.length));
  const contents = items.map((it, i) => {
    const arrow = i === index ? "▸" : " ";
    const label = it.label.padEnd(maxLabelLen);
    const sub = it.sublabel ? `  ${it.sublabel}` : "";
    return ` ${arrow}  ${label}${sub}`;
  });
  const maxLen = Math.max(...contents.map((c) => c.length));

  return (
    <Box flexDirection="column">
      <Header title="Settings" hint="↑↓ · ⏎ select · esc back" />
      {items.map((it, i) => {
        const active = i === index;
        const content =
          contents[i] + " ".repeat(maxLen - contents[i].length) + "  ";
        const danger = it.id === "resetAll";
        return (
          <Box key={it.id}>
            <Text
              backgroundColor={
                active ? (danger ? "red" : "magenta") : undefined
              }
              color={active ? "white" : danger ? "red" : undefined}
              bold={active}
            >
              {content}
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
    </Box>
  );
}
