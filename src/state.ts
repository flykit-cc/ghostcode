import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_PATH = join(homedir(), ".config/ghostcode/state.json");

export type PerProjectState = {
  providerId?: string;
  effort?: string;
  model?: string;
  vscode?: boolean;
  mode?: string;
  // Background color applied to the project name everywhere it's displayed.
  // Hex string (e.g. "#8b4a3a") or undefined for no tint.
  color?: string;
  // Work-tracker opt-in: sessions in this project log time + tokens.
  track?: boolean;
};

// Muted palette with decent contrast against white bold fg. Cycled on `c`
// in the project picker. Order is deliberate — goes warm → cool.
export const PROJECT_COLOR_PALETTE = [
  "#8b4a3a", // rust
  "#8b6a3a", // amber
  "#6a8b3a", // olive
  "#3a8b4a", // green
  "#3a8b7a", // teal
  "#3a6a8b", // blue
  "#6a3a8b", // purple
  "#8b3a6a", // rose
];

export function cycleProjectColor(current?: string): string | undefined {
  if (!current) return PROJECT_COLOR_PALETTE[0];
  const idx = PROJECT_COLOR_PALETTE.indexOf(current);
  if (idx < 0) return PROJECT_COLOR_PALETTE[0];
  if (idx === PROJECT_COLOR_PALETTE.length - 1) return undefined;
  return PROJECT_COLOR_PALETTE[idx + 1];
}

export type State = {
  recents: string[];
  favorites: string[];
  perProject: Record<string, PerProjectState>;
  lastProviderId?: string;
  lastMode?: string;
};

const EMPTY: State = { recents: [], favorites: [], perProject: {} };

export function loadState(): State {
  if (!existsSync(STATE_PATH)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(
      readFileSync(STATE_PATH, "utf8"),
    ) as Partial<State>;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

export function saveState(s: State): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

export function bumpRecent(s: State, projectPath: string, max = 8): State {
  const recents = [
    projectPath,
    ...s.recents.filter((r) => r !== projectPath),
  ].slice(0, max);
  return { ...s, recents };
}

export function toggleFavorite(s: State, projectPath: string): State {
  const exists = s.favorites.includes(projectPath);
  const favorites = exists
    ? s.favorites.filter((p) => p !== projectPath)
    : [...s.favorites, projectPath];
  return { ...s, favorites };
}

export function clearRecents(s: State): State {
  return { ...s, recents: [] };
}

export function setProjectColor(
  s: State,
  projectPath: string,
  color: string | undefined,
): State {
  const cur = s.perProject[projectPath] ?? {};
  return {
    ...s,
    perProject: { ...s.perProject, [projectPath]: { ...cur, color } },
  };
}

export function setProjectTracking(
  s: State,
  projectPath: string,
  on: boolean,
): State {
  const cur = s.perProject[projectPath] ?? {};
  return {
    ...s,
    perProject: { ...s.perProject, [projectPath]: { ...cur, track: on } },
  };
}

export function clearFavorites(s: State): State {
  return { ...s, favorites: [] };
}

export function clearTints(s: State): State {
  const perProject: Record<string, PerProjectState> = {};
  for (const [path, v] of Object.entries(s.perProject)) {
    const { color: _drop, ...rest } = v;
    perProject[path] = rest;
  }
  return { ...s, perProject };
}

export function resetState(): State {
  return {
    recents: [],
    favorites: [],
    perProject: {},
  };
}

export function countTints(s: State): number {
  return Object.values(s.perProject).filter((v) => v.color).length;
}
