import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { ACCENT, SELECTION_BG } from "./theme.ts";

type Props = {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmScreen({
  title,
  message,
  danger,
  confirmLabel = "Yes",
  cancelLabel = "No",
  onConfirm,
  onCancel,
}: Props) {
  // Default focus on the safe choice (No).
  const [index, setIndex] = useState(1);

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (input === "y" || input === "Y") return onConfirm();
    if (input === "n" || input === "N") return onCancel();
    if (key.leftArrow || key.rightArrow || key.tab)
      return setIndex((i) => (i === 0 ? 1 : 0));
    if (key.return) {
      if (index === 0) onConfirm();
      else onCancel();
    }
  });

  const items = [confirmLabel, cancelLabel];
  const activeColor = danger ? "red" : ACCENT;

  return (
    <Box flexDirection="column">
      <Header title={title} />
      <Box marginTop={1} paddingX={1}>
        <Text>{message}</Text>
      </Box>
      <Box marginTop={1}>
        {items.map((label, i) => {
          const active = i === index;
          const bg = active ? (i === 0 ? activeColor : SELECTION_BG) : undefined;
          return (
            <Text
              key={label}
              backgroundColor={bg}
              color={active ? "white" : undefined}
              bold={active}
            >
              {`  ${active ? "▸" : " "} ${label}  `}
            </Text>
          );
        })}
      </Box>
      <Footer hint="Y/N · ←→ · ⏎ select · esc cancel" />
    </Box>
  );
}
