import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { ACCENT, SELECTION_BG } from "./theme.ts";
import { SecretPrompt } from "./SecretPrompt.tsx";
import type { Provider } from "../providers.ts";
import { hasSecret, setSecret, deleteSecret } from "../keychain.ts";

type Props = {
  providers: Provider[];
  onDone: () => void;
};

type Mode = { kind: "list" } | { kind: "edit"; provider: Provider };

export function ApiKeysScreen({ providers, onDone }: Props) {
  const withSecret = providers.filter((p) => !!p.secret);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [rev, setRev] = useState(0);

  useInput((input, key) => {
    if (mode.kind !== "list") return;
    if (key.escape) return onDone();
    if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow)
      return setIndex((i) => Math.min(withSecret.length - 1, i + 1));
    const pick = withSecret[index];
    if (!pick) return;
    if (key.return) {
      setMode({ kind: "edit", provider: pick });
      return;
    }
    if (input === "D" || input === "d") {
      if (pick.secret && hasSecret(pick.secret.keychainService)) {
        deleteSecret(pick.secret.keychainService);
        setRev((r) => r + 1);
      }
    }
  });

  if (mode.kind === "edit" && mode.provider.secret) {
    return (
      <SecretPrompt
        providerLabel={mode.provider.label}
        onSubmit={(v) => {
          setSecret(mode.provider.secret!.keychainService, v);
          setMode({ kind: "list" });
          setRev((r) => r + 1);
        }}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  // Render list. Use rev to re-query status after mutations.
  void rev;
  const rows = withSecret.map((p) => {
    const set = p.secret ? hasSecret(p.secret.keychainService) : false;
    return {
      provider: p,
      label: p.label,
      status: set ? "set" : "— not set —",
      set,
    };
  });
  const maxLabelLen = Math.max(4, ...rows.map((r) => r.label.length));

  return (
    <Box flexDirection="column">
      <Header title="API keys" />
      {rows.length === 0 && (
        <Text dimColor> no providers require a key</Text>
      )}
      {rows.map((r, i) => {
        const active = i === index;
        const label = r.label.padEnd(maxLabelLen);
        const bg = active ? SELECTION_BG : undefined;
        return (
          <Box key={r.provider.id}>
            <Text backgroundColor={bg} color={ACCENT} bold={active}>
              {` ${active ? "▸" : " "}  `}
            </Text>
            <Text
              backgroundColor={bg}
              color={active ? "white" : undefined}
              bold={active}
            >
              {`${label}  `}
            </Text>
            <Text
              backgroundColor={bg}
              color={r.set ? "green" : "yellow"}
              bold={active}
            >
              {r.status}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>
          Keys are stored in macOS Keychain under account "ghostcode".
        </Text>
      </Box>
      <Footer hint="↑↓ · ⏎ set/replace · D delete · esc back" />
    </Box>
  );
}
