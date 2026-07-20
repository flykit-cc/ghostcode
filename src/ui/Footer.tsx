import React from "react";
import { Box, Text } from "ink";

// Dim keybind bar pinned under a screen's content — every screen renders one
// so help lives in the same place everywhere.
export function Footer({ hint }: { hint: string }) {
  return (
    <Box marginTop={1} paddingX={1}>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
