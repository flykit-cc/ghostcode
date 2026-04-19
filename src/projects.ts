import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// ~/.config/ghostcode/config.json controls where projects are discovered.
// Users edit this file to add their own roots — the launcher is plugin-friendly.
// Example:
//   { "projectRoots": ["~/Documents/GitHub", "~/Sandbox", "~/work/clients"] }
const CONFIG_PATH = join(homedir(), ".config/ghostcode/config.json");
const DEFAULT_ROOTS = [
  join(homedir(), "Documents/GitHub"),
  join(homedir(), "Sandbox"),
];

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1).replace(/^\//, "")) : p;
}

export function loadRoots(): string[] {
  if (existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      if (Array.isArray(cfg.projectRoots) && cfg.projectRoots.length > 0) {
        return cfg.projectRoots.map(expandHome);
      }
    } catch {
      // malformed → fall through to defaults
    }
  }
  // First run: write a template so users can discover + edit.
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    if (!existsSync(CONFIG_PATH)) {
      writeFileSync(
        CONFIG_PATH,
        JSON.stringify({ projectRoots: DEFAULT_ROOTS }, null, 2),
      );
    }
  } catch {
    // ignore — non-fatal
  }
  return DEFAULT_ROOTS;
}

// parent = basename of the root dir (e.g. "GitHub" for ~/Documents/GitHub).
// Needed because ~/Documents/GitHub/earthflix and ~/Sandbox/earthflix would
// otherwise look identical in the picker.
export type Project = { name: string; parent: string; path: string };

export function projectDisplay(p: Project): string {
  return `${p.parent}/${p.name}`;
}

export function discoverProjects(): Project[] {
  const roots = loadRoots();
  const out: Project[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    const parent = basename(root);
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const path = join(root, name);
      try {
        if (statSync(path).isDirectory()) out.push({ name, parent, path });
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return out.sort(
    (a, b) => a.name.localeCompare(b.name) || a.parent.localeCompare(b.parent),
  );
}

export function fuzzyFilter(projects: Project[], query: string): Project[] {
  if (!query) return projects;
  const q = query.toLowerCase();
  const scored = projects
    .map((p) => {
      const n = p.name.toLowerCase();
      const full = `${p.parent.toLowerCase()}/${n}`;
      if (n === q) return { p, score: 0 };
      if (n.startsWith(q)) return { p, score: 1 };
      if (n.includes(q)) return { p, score: 2 };
      if (full.includes(q)) return { p, score: 3 };
      // subsequence match across full path (matches "gh/ef" for "GitHub/earthflix")
      let i = 0;
      for (const c of full) if (c === q[i]) i++;
      return i === q.length ? { p, score: 4 } : null;
    })
    .filter((x): x is { p: Project; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
  return scored.map((x) => x.p);
}
