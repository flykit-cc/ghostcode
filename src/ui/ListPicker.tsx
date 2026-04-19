import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";

export type ListItem = { id: string; label: string; sublabel?: string };

type Props = {
  title: string;
  items: ListItem[];
  initialId?: string;
  onPick: (item: ListItem) => void;
  onCancel: () => void;
};

export function ListPicker({
  title,
  items,
  initialId,
  onPick,
  onCancel,
}: Props) {
  const [index, setIndex] = useState(() => {
    const i = items.findIndex((it) => it.id === initialId);
    return i >= 0 ? i : 0;
  });

  useInput((_input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const pick = items[index];
      if (pick) onPick(pick);
      return;
    }
    if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow)
      return setIndex((i) => Math.min(items.length - 1, i + 1));
  });

  // Build all row contents first, then pad to a uniform width so the magenta
  // background on the active row looks like a solid block — not a ragged edge.
  const contents = items.map((it, i) => {
    const arrow = i === index ? "▸" : " ";
    const sub = it.sublabel ? `  ·  ${it.sublabel}` : "";
    return ` ${arrow}  ${it.label}${sub}`;
  });
  const maxLen = Math.max(...contents.map((c) => c.length));
  const padded = contents.map((c) => c + " ".repeat(maxLen - c.length) + "  ");

  return (
    <Box flexDirection="column">
      <Header title={title} hint="↑↓ · ⏎ select · esc back" />
      {items.map((it, i) => {
        const active = i === index;
        return (
          <Box key={it.id}>
            <Text
              backgroundColor={active ? "magenta" : undefined}
              color={active ? "white" : undefined}
              bold={active}
            >
              {padded[i]}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
