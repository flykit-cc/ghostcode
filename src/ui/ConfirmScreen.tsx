import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";

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
  const activeColor = danger ? "red" : "magenta";

  return (
    <Box flexDirection="column">
      <Header title={title} hint="Y/N · ←→ · ⏎ select · esc cancel" />
      <Box marginTop={1}>
        <Text> {message}</Text>
      </Box>
      <Box marginTop={1}>
        {items.map((label, i) => {
          const active = i === index;
          const bg = active ? (i === 0 ? activeColor : "gray") : undefined;
          const fg = active ? (i === 0 && danger ? "white" : "white") : undefined;
          return (
            <Text
              key={label}
              backgroundColor={bg}
              color={fg}
              bold={active}
            >
              {`  ${active ? "▸" : " "} ${label}  `}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
