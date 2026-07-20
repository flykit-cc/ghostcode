import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { ACCENT, SELECTION_BG } from "./theme.ts";
import { fuzzyFilter, type Project } from "../projects.ts";

type Props = {
  projects: Project[];
  recents: string[];
  favorites: string[];
  getColor: (path: string) => string | undefined;
  // Saved-setup label for a project ("GLM · Bypass"), shown as a dim column.
  getSetup: (path: string) => string | undefined;
  onPick: (p: Project) => void;
  // Digit keys 1-9: launch that row immediately with its saved defaults.
  onJumpLaunch: (p: Project) => void;
  onToggleFavorite: (p: Project) => void;
  onCycleColor: (p: Project) => void;
  onCancel: () => void;
};

const HEIGHT = 12;

type Group = "favorites" | "recent" | "projects";

const GROUP_LABEL: Record<Group, string> = {
  favorites: "FAVORITES",
  recent: "RECENT",
  projects: "PROJECTS",
};

export function ProjectPicker({
  projects,
  recents,
  favorites,
  getColor,
  getSetup,
  onPick,
  onJumpLaunch,
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
    // Digits jump-launch the numbered row — only while the filter is empty,
    // so typing project names containing digits still works mid-query.
    if (!query && /^[1-9]$/.test(input) && !key.ctrl && !key.meta) {
      const target = ordered[Number(input) - 1];
      if (target) onJumpLaunch(target);
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

  const groupOf = (p: Project): Group =>
    favSet.has(p.path)
      ? "favorites"
      : recentSet.has(p.path)
        ? "recent"
        : "projects";

  // Column layout: [arrow digit star] [▎tint] [name] [parent] [setup].
  // Widths are computed over the visible slice so columns line up exactly.
  type RowSpec = {
    p: Project;
    active: boolean;
    group: Group;
    color?: string;
    arrow: string;
    digit: string;
    star: string;
    name: string;
    parent: string;
    setup: string;
  };
  const rows: RowSpec[] = visible.map((p, i) => {
    const realIndex = Math.max(0, start) + i;
    const active = realIndex === index;
    return {
      p,
      active,
      group: groupOf(p),
      color: getColor(p.path),
      arrow: active ? "▸" : " ",
      digit: !query && realIndex < 9 ? String(realIndex + 1) : " ",
      star: favSet.has(p.path) ? "★" : " ",
      name: p.name,
      parent: p.parent,
      setup: getSetup(p.path) ?? "",
    };
  });
  const nameW = Math.max(0, ...rows.map((r) => r.name.length)) + 2;
  const parentW = Math.max(0, ...rows.map((r) => r.parent.length)) + 2;
  const setupW = Math.max(0, ...rows.map((r) => r.setup.length));

  return (
    <Box flexDirection="column">
      <Header title="Project" />
      <Box paddingX={1}>
        <Text color={ACCENT}>❯ </Text>
        {query ? <Text>{query}</Text> : <Text dimColor>type to filter</Text>}
        <Text color={ACCENT}>▏</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 && <Text dimColor>   no matches</Text>}
        {rows.map((r, i) => {
          const showLabel =
            !query && (i === 0 || rows[i - 1].group !== r.group);
          const bg = r.active ? SELECTION_BG : undefined;
          const fg = r.active ? "white" : undefined;
          return (
            <Box key={r.p.path} flexDirection="column">
              {showLabel && (
                <Box marginTop={i === 0 ? 0 : 0}>
                  <Text dimColor>{`      ${GROUP_LABEL[r.group]}`}</Text>
                </Box>
              )}
              <Box>
                <Text backgroundColor={bg} color={ACCENT} bold={r.active}>
                  {` ${r.arrow} `}
                </Text>
                <Text backgroundColor={bg} dimColor>
                  {`${r.digit} `}
                </Text>
                <Text backgroundColor={bg} color="yellow">
                  {`${r.star} `}
                </Text>
                {/* Slim tint bar — carries the project color without painting
                    the whole row like a pill. */}
                <Text backgroundColor={bg} color={r.color}>
                  {r.color ? "▎" : " "}
                </Text>
                <Text backgroundColor={bg} color={fg} bold={r.active}>
                  {` ${r.name.padEnd(nameW)}`}
                </Text>
                <Text backgroundColor={bg} color={fg} dimColor>
                  {r.parent.padEnd(parentW)}
                </Text>
                <Text backgroundColor={bg} color={fg} dimColor>
                  {r.setup.padEnd(setupW)}
                </Text>
                <Text backgroundColor={bg}>{"  "}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Footer hint="type to filter · ↑↓ · ⏎ open · 1-9 launch · ⇧F favorite · ⇧C tint · esc" />
    </Box>
  );
}
