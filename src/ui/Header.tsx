import React from "react";
import { Box, Text } from "ink";
import { LOGO } from "../logo.ts";

// Claude Code brand orange.
const CC_ORANGE = "#d97757";

// Kaio-provided CC mark. Kept verbatim — do not reflow the trailing spaces,
// they keep the legs aligned under the body.
const CC_ART = [" ▐▛███▜▌   ", "▝▜█████▛▘  ", "  ▘▘ ▝▝    "];

export function Header({ title, hint }: { title: string; hint: string }) {
  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
      paddingX={2}
      marginBottom={1}
      flexDirection="column"
    >
      {/* alignItems center keeps the 2-line GhostCode logo vertically
          centered next to the 3-line CC mark — closest we can get without
          a 3-line block font (tiny is the only 2-line one; everything else
          jumps to 4+). */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text>{LOGO}</Text>
        <Box flexDirection="column" alignItems="flex-end">
          {CC_ART.map((line, i) => (
            <Text key={i} color={CC_ORANGE}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
      {title ? (
        <Box marginTop={1}>
          <Text bold>{title}</Text>
        </Box>
      ) : null}
      <Text dimColor>{hint}</Text>
      <Box justifyContent="flex-end" marginTop={1}>
        <Text dimColor>flykit.cc by @kaiomp</Text>
      </Box>
    </Box>
  );
}
