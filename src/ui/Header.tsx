import React from "react";
import { Box, Text } from "ink";
import { ACCENT } from "./theme.ts";
import pkg from "../../package.json" with { type: "json" };

// Compact product header: one brand line + a dim rule. The screen name rides
// as a breadcrumb next to the wordmark; keybind help lives in the Footer.
export function Header({ title }: { title?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text>👻 </Text>
          <Text bold color={ACCENT}>
            GHOSTCODE
          </Text>
          {title ? (
            <>
              <Text dimColor>{"  ▸ "}</Text>
              <Text>{title}</Text>
            </>
          ) : null}
        </Box>
        <Text dimColor>flykit.cc · v{pkg.version}</Text>
      </Box>
      <Box
        borderStyle="single"
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderDimColor
      />
    </Box>
  );
}
