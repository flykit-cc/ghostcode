import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { ACCENT, SELECTION_BG } from "./theme.ts";

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

  // Two-column layout: labels left-aligned to the widest label, sublabels
  // dim after a fixed 2-space gutter.
  const maxLabelLen = Math.max(...items.map((it) => it.label.length));
  const maxSubLen = Math.max(
    0,
    ...items.map((it) => (it.sublabel ? it.sublabel.length : 0)),
  );

  return (
    <Box flexDirection="column">
      <Header title={title} />
      {items.map((it, i) => {
        const active = i === index;
        const bg = active ? SELECTION_BG : undefined;
        return (
          <Box key={it.id}>
            <Text backgroundColor={bg} color={ACCENT} bold={active}>
              {` ${active ? "▸" : " "}  `}
            </Text>
            <Text
              backgroundColor={bg}
              color={active ? "white" : undefined}
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
      <Footer hint="↑↓ · ⏎ select · esc back" />
    </Box>
  );
}
