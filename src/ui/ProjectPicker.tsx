import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { fuzzyFilter, projectDisplay, type Project } from "../projects.ts";

type Props = {
  projects: Project[];
  recents: string[];
  favorites: string[];
  getColor: (path: string) => string | undefined;
  onPick: (p: Project) => void;
  onToggleFavorite: (p: Project) => void;
  onCycleColor: (p: Project) => void;
  onCancel: () => void;
};

const HEIGHT = 12;

export function ProjectPicker({
  projects,
  recents,
  favorites,
  getColor,
  onPick,
  onToggleFavorite,
  onCycleColor,
  onCancel,
}: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const ordered = useMemo(() => {
    if (query) return fuzzyFilter(projects, query);
    const favSet = new Set(favorites);
    const recentSet = new Set(recents);
    const favs = favorites
      .map((p) => projects.find((pr) => pr.path === p))
      .filter((p): p is Project => !!p);
    const recentOnly = recents
      .map((p) => projects.find((pr) => pr.path === p))
      .filter((p): p is Project => !!p && !favSet.has(p.path));
    const rest = projects.filter(
      (p) => !favSet.has(p.path) && !recentSet.has(p.path),
    );
    return [...favs, ...recentOnly, ...rest];
  }, [projects, query, recents, favorites]);

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const pick = ordered[index];
      if (pick) onPick(pick);
      return;
    }
    if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow)
      return setIndex((i) => Math.min(ordered.length - 1, i + 1));
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setIndex(0);
      return;
    }
    // Uppercase keybinds so lowercase letters are always free for fuzzy
    // filter input (e.g. typing "claude" no longer hijacks to a tint cycle).
    if (input === "F" && !key.ctrl && !key.meta) {
      const focused = ordered[index];
      if (focused) onToggleFavorite(focused);
      return;
    }
    if (input === "C" && !key.ctrl && !key.meta) {
      const focused = ordered[index];
      if (focused) onCycleColor(focused);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setIndex(0);
    }
  });

  const start = Math.max(
    0,
    Math.min(index - Math.floor(HEIGHT / 2), ordered.length - HEIGHT),
  );
  const visible = ordered.slice(Math.max(0, start), start + HEIGHT);
  const favSet = new Set(favorites);
  const recentSet = new Set(recents);

  // Pre-compute row lengths so the active-row highlight and tint blocks line
  // up to the same width. Each row is split into [prefix][name][tail] so the
  // per-project bg tint can wrap just the name, like the CC statusline pill.
  type RowSpec = {
    p: Project;
    active: boolean;
    isFav: boolean;
    isRecent: boolean;
    color?: string;
    prefix: string;
    name: string;
    totalLen: number;
  };
  const rows: RowSpec[] = visible.map((p, i) => {
    const realIndex = Math.max(0, start) + i;
    const active = realIndex === index;
    const isFav = favSet.has(p.path);
    const isRecent = !isFav && !query && recentSet.has(p.path);
    const marker = isFav ? "★" : isRecent ? "⏱" : " ";
    const arrow = active ? "▸" : " ";
    const prefix = ` ${arrow} ${marker} `;
    const name = ` ${projectDisplay(p)} `;
    return {
      p,
      active,
      isFav,
      isRecent,
      color: getColor(p.path),
      prefix,
      name,
      totalLen: prefix.length + name.length,
    };
  });
  const maxLen = rows.length ? Math.max(...rows.map((r) => r.totalLen)) : 0;

  return (
    <Box flexDirection="column">
      <Header
        title="Project"
        hint="type to filter · ↑↓ · ⏎ open · ⇧F favorite · ⇧C tint · esc"
      />
      <Box>
        <Text color="magenta"> </Text>
        <Text>{query}</Text>
        <Text color="magenta">▏</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 && <Text dimColor> no matches</Text>}
        {rows.map((r) => {
          const tail = " ".repeat(maxLen - r.totalLen + 2);
          const activeBg = r.active ? "magenta" : undefined;
          const activeFg = r.active ? "white" : undefined;
          // Inactive coloring priority: favorite (yellow) > recent (cyan) > default.
          const inactiveFg = r.isFav
            ? "yellow"
            : r.isRecent
              ? "cyan"
              : undefined;
          // The 2-space tint pill is rendered as its OWN Text with its own bg,
          // so it stays visible even when the rest of the row gets the
          // magenta active-selection bg. No tint set = empty 2-space gap
          // (keeps alignment across rows).
          return (
            <Box key={r.p.path}>
              <Text
                backgroundColor={activeBg}
                color={activeFg ?? inactiveFg}
                bold={r.active}
              >
                {r.prefix}
              </Text>
              <Text backgroundColor={r.color}>{"  "}</Text>
              <Text
                backgroundColor={r.active ? "magenta" : r.color}
                color={r.active ? "white" : r.color ? "white" : inactiveFg}
                bold={r.active}
              >
                {r.name}
              </Text>
              <Text backgroundColor={activeBg} color={activeFg}>
                {tail}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
