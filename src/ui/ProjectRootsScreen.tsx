import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { SELECTION_BG } from "./theme.ts";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_PATH = join(homedir(), ".config/ghostcode/config.json");

type Mode = { kind: "list" } | { kind: "edit"; index: number } | { kind: "add" };

type Props = {
  onDone: () => void;
};

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1).replace(/^\//, "")) : p;
}

function loadRootsRaw(): string[] {
  if (!existsSync(CONFIG_PATH)) return [];
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return Array.isArray(cfg.projectRoots) ? cfg.projectRoots : [];
  } catch {
    return [];
  }
}

function saveRoots(roots: string[]): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const existing = existsSync(CONFIG_PATH)
    ? (() => {
        try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
        catch { return {}; }
      })()
    : {};
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ ...existing, projectRoots: roots }, null, 2),
  );
}

function renderRoot(p: string): string {
  return p.replace(homedir(), "~");
}

export function ProjectRootsScreen({ onDone }: Props) {
  const [roots, setRoots] = useState<string[]>(() => loadRootsRaw());
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [buffer, setBuffer] = useState("");

  useInput((input, key) => {
    if (mode.kind === "list") {
      if (key.escape) return onDone();
      if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
      if (key.downArrow)
        return setIndex((i) => Math.min(Math.max(0, roots.length - 1), i + 1));
      if (key.return && roots[index]) {
        setBuffer(renderRoot(roots[index]));
        setMode({ kind: "edit", index });
        return;
      }
      if (input === "N" || input === "n") {
        setBuffer("");
        setMode({ kind: "add" });
        return;
      }
      if (input === "D" || input === "d") {
        if (!roots[index]) return;
        const next = roots.filter((_, i) => i !== index);
        setRoots(next);
        saveRoots(next);
        setIndex((i) => Math.max(0, Math.min(i, next.length - 1)));
        return;
      }
      return;
    }

    // edit / add mode
    if (key.escape) {
      setMode({ kind: "list" });
      setBuffer("");
      return;
    }
    if (key.return) {
      const value = buffer.trim();
      if (!value) {
        setMode({ kind: "list" });
        return;
      }
      const absolute = expandHome(value);
      let next: string[];
      if (mode.kind === "edit") {
        next = roots.map((r, i) => (i === mode.index ? absolute : r));
      } else {
        next = [...roots, absolute];
      }
      setRoots(next);
      saveRoots(next);
      setMode({ kind: "list" });
      setBuffer("");
      setIndex(mode.kind === "add" ? next.length - 1 : mode.index);
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((b) => b.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setBuffer((b) => b + input);
    }
  });

  const hint =
    mode.kind === "list"
      ? "↑↓ move · ⏎ edit · N add · D delete · esc back"
      : "type path · ⏎ save · esc cancel";

  return (
    <Box flexDirection="column">
      <Header title="Project roots" />
      {roots.length === 0 && mode.kind === "list" && (
        <Text dimColor> no roots — press N to add</Text>
      )}
      {roots.map((r, i) => {
        const active = mode.kind === "list" && i === index;
        const editing = mode.kind === "edit" && mode.index === i;
        const display = editing ? buffer : renderRoot(r);
        const missing = !existsSync(expandHome(r));
        return (
          <Box key={r + i}>
            <Text
              backgroundColor={active ? SELECTION_BG : undefined}
              color={active ? "white" : missing ? "yellow" : undefined}
              bold={active}
            >
              {` ${active ? "▸" : " "}  ${display}${editing ? "▏" : ""}${missing ? "  (missing)" : ""}`}
            </Text>
          </Box>
        );
      })}
      {mode.kind === "add" && (
        <Box>
          <Text color="magenta"> + </Text>
          <Text>{buffer}</Text>
          <Text color="magenta">▏</Text>
        </Box>
      )}
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>
          Stored in {CONFIG_PATH.replace(homedir(), "~")}
        </Text>
      </Box>
      <Footer hint={hint} />
    </Box>
  );
}
