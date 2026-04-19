import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";

type Props = {
  providerLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export function SecretPrompt({ providerLabel, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      if (value.trim()) onSubmit(value.trim());
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) setValue((v) => v + input);
  });

  return (
    <Box flexDirection="column">
      <Header
        title={`${providerLabel} — API key`}
        hint="paste · ⏎ save to Keychain · esc cancel"
      />
      <Box>
        <Text color="magenta"> </Text>
        <Text>{"•".repeat(Math.min(value.length, 40))}</Text>
        <Text color="magenta">▏</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Stored encrypted in macOS Keychain. You'll only be asked once.
        </Text>
      </Box>
    </Box>
  );
}
