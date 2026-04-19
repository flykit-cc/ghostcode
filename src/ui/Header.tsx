import React from "react";
import { Box, Text } from "ink";
import { LOGO, FLYKIT_LOGO } from "../logo.ts";
import pkg from "../../package.json" with { type: "json" };

const CC_ORANGE = "#d97757";

// Kaio-provided CC mark — do NOT reflow trailing spaces, they keep the
// legs aligned under the body.
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
      {/* Parent row: alignItems center so the 3-line left stack (logo + mascot)
          centers vertically against the 4-line flykit logo on the right. */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        {/* Left: GHOSTCODE logo (2 lines) + 2-space gap + CC mascot (3 lines).
            alignItems center here keeps the 2-line logo centered against the
            3-line mascot — same trick the old Header used. */}
        <Box flexDirection="row" alignItems="center">
          <Text>{LOGO}</Text>
          <Box marginLeft={2} flexDirection="column">
            {CC_ART.map((line, i) => (
              <Text key={i} color={CC_ORANGE}>
                {line}
              </Text>
            ))}
          </Box>
        </Box>

        {/* Right: flykit ASCII logo, 4 lines, plain white so it doesn't
            compete with the purple gradient or orange mascot. */}
        <Box flexDirection="column" alignItems="flex-end">
          {FLYKIT_LOGO.map((line, i) => (
            <Text key={i} color="white">
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
        <Text dimColor>
          v{pkg.version} · by @kaiomp
        </Text>
      </Box>
    </Box>
  );
}
