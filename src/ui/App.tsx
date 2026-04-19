import React, { useMemo, useState } from "react";
import { useApp } from "ink";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Dashboard, type DashboardValues } from "./Dashboard.tsx";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { ListPicker, type ListItem } from "./ListPicker.tsx";
import { SecretPrompt } from "./SecretPrompt.tsx";
import { SettingsScreen, type SettingsAction } from "./SettingsScreen.tsx";
import { discoverProjects, loadRoots, type Project } from "../projects.ts";
import { loadProviders, type Provider } from "../providers.ts";
import {
  loadState,
  saveState,
  bumpRecent,
  toggleFavorite,
  clearRecents,
  setProjectColor,
  cycleProjectColor,
  clearFavorites,
  clearTints,
  resetState,
  countTints,
} from "../state.ts";
import { setSecret, getSecret } from "../keychain.ts";
import { detectVSCode } from "../env.ts";
import type { PermissionMode } from "../launch.ts";

type Mode =
  | "dashboard"
  | "project"
  | "provider"
  | "model"
  | "effort"
  | "mode"
  | "settings"
  | "secret";

export type Outcome =
  | { kind: "quit" }
  | {
      kind: "launch";
      values: DashboardValues;
      secretValue?: string;
    };

type Props = { onDone: (outcome: Outcome) => void };

const CONFIG_PATH = join(homedir(), ".config/ghostcode/config.json");
const SETUP_MARKER = join(homedir(), ".config/ghostcode/.setup-complete");

const EFFORT_ITEMS: ListItem[] = [
  { id: "default", label: "Medium", sublabel: "default" },
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "xhigh" },
  { id: "max", label: "Max" },
];

const MODE_ITEMS: ListItem[] = [
  {
    id: "bypassPermissions",
    label: "Bypass",
    sublabel: "skip all permission checks (default)",
  },
  { id: "auto", label: "Auto", sublabel: "auto classifier" },
  {
    id: "acceptEdits",
    label: "Accept edits",
    sublabel: "auto-accept edit tools, prompt for others",
  },
  { id: "plan", label: "Plan", sublabel: "research + plan, no edits" },
  { id: "default", label: "Ask each time", sublabel: "prompt for everything" },
];

const CLAUDE_MODEL_ITEMS: ListItem[] = [
  { id: "", label: "Opus", sublabel: "default" },
  { id: "sonnet", label: "Sonnet" },
];

function modelItems(provider: Provider): ListItem[] {
  if (provider.supportsClaudeFlags) return CLAUDE_MODEL_ITEMS;
  if (provider.models?.length) {
    return provider.models.map((m, i) => ({
      id: m.id,
      label: m.label,
      sublabel: i === 0 ? "default" : undefined,
    }));
  }
  return [];
}

export function App({ onDone }: Props) {
  const { exit } = useApp();
  const providers = useMemo(() => loadProviders(), []);
  const vsCodeAvailable = useMemo(() => detectVSCode(), []);
  const roots = useMemo(() => loadRoots(), []);

  // Projects are reloaded when we exit settings (in case config was edited).
  const [projectRev, setProjectRev] = useState(0);
  const projects = useMemo(
    () => discoverProjects(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectRev],
  );

  const [state, setState] = useState(() => loadState());

  const defaultProvider =
    providers.find((p) => p.id === state.lastProviderId) ?? providers[0];
  const defaultMode = (state.lastMode as PermissionMode) ?? "bypassPermissions";

  // If we have a most-recent project, pre-select it. Dashboard lands with
  // Launch pre-focused so returning users re-launch with a single Enter.
  const initialProject = useMemo(() => {
    const lastPath = state.recents[0];
    if (!lastPath) return null;
    return projects.find((p) => p.path === lastPath) ?? null;
  }, [projects, state.recents]);

  const [values, setValues] = useState<DashboardValues>(() => {
    const saved = initialProject
      ? state.perProject[initialProject.path]
      : undefined;
    return {
      project: initialProject,
      provider: saved?.providerId
        ? (providers.find((p) => p.id === saved.providerId) ?? defaultProvider)
        : defaultProvider,
      model: saved?.model ?? "",
      effort: (saved?.effort as DashboardValues["effort"]) ?? "default",
      mode: (saved?.mode as PermissionMode) ?? defaultMode,
      openVSCode: saved?.vscode ?? false,
    };
  });

  const [mode, setMode] = useState<Mode>("dashboard");
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);

  const recents = state.recents
    .map((p) => projects.find((pr) => pr.path === p))
    .filter((p): p is Project => !!p);

  function finish(outcome: Outcome) {
    exit();
    onDone(outcome);
  }

  function applyProjectDefaults(project: Project): DashboardValues {
    const saved = state.perProject[project.path];
    const next: DashboardValues = {
      ...values,
      project,
      provider: saved?.providerId
        ? (providers.find((p) => p.id === saved.providerId) ?? values.provider)
        : values.provider,
      effort: (saved?.effort as DashboardValues["effort"]) ?? values.effort,
      model: saved?.model ?? values.model,
      mode: (saved?.mode as PermissionMode) ?? values.mode,
      openVSCode: saved?.vscode ?? values.openVSCode,
    };
    setValues(next);
    return next;
  }

  function performLaunch(vals: DashboardValues) {
    if (!vals.project) return;
    const provider = vals.provider;
    let secretValue: string | undefined;
    if (provider.secret) {
      const v = getSecret(provider.secret.keychainService);
      if (!v) {
        setPendingProvider(provider);
        setMode("secret");
        return;
      }
      secretValue = v;
    }
    const next = bumpRecent(
      {
        ...state,
        lastProviderId: provider.id,
        lastMode: vals.mode,
        perProject: {
          ...state.perProject,
          [vals.project.path]: {
            ...state.perProject[vals.project.path],
            providerId: provider.id,
            effort: vals.effort,
            model: vals.model,
            mode: vals.mode,
            vscode: vals.openVSCode,
          },
        },
      },
      vals.project.path,
    );
    saveState(next);
    setState(next);
    finish({ kind: "launch", values: vals, secretValue });
  }

  function handleSettingsAction(action: SettingsAction) {
    switch (action) {
      case "editConfig":
        // `open` is async + GUI — doesn't fight Ink for the terminal.
        spawn("open", [CONFIG_PATH], { stdio: "ignore", detached: true });
        setMode("dashboard");
        break;
      case "clearRecents": {
        const next = clearRecents(state);
        saveState(next);
        setState(next);
        break;
      }
      case "clearFavorites": {
        const next = clearFavorites(state);
        saveState(next);
        setState(next);
        break;
      }
      case "clearTints": {
        const next = clearTints(state);
        saveState(next);
        setState(next);
        break;
      }
      case "rerunSetup": {
        // Delete the marker so launcher.sh runs init.sh on next Ghostty open.
        // We exit the current session — user reopens Ghostty to redo setup.
        try {
          rmSync(SETUP_MARKER, { force: true });
        } catch {
          // ignore
        }
        process.stdout.write(
          "\n\x1b[35mSetup will re-run next time you open Ghostty.\x1b[0m\n",
        );
        finish({ kind: "quit" });
        break;
      }
      case "resetAll": {
        const next = resetState();
        saveState(next);
        setState(next);
        setValues((v) => ({ ...v, project: null }));
        setMode("dashboard");
        break;
      }
      case "back":
        // Re-discover projects in case the user edited the config file.
        setProjectRev((r) => r + 1);
        setMode("dashboard");
        break;
    }
  }

  if (mode === "project") {
    return (
      <ProjectPicker
        projects={projects}
        recents={state.recents}
        favorites={state.favorites}
        getColor={(path) => state.perProject[path]?.color}
        onPick={(p) => {
          applyProjectDefaults(p);
          setMode("dashboard");
        }}
        onToggleFavorite={(p) => {
          const next = toggleFavorite(state, p.path);
          saveState(next);
          setState(next);
        }}
        onCycleColor={(p) => {
          const current = state.perProject[p.path]?.color;
          const next = setProjectColor(
            state,
            p.path,
            cycleProjectColor(current),
          );
          saveState(next);
          setState(next);
        }}
        onCancel={() => {
          // If there's already a project, ESC returns to dashboard.
          // If nothing is picked and we have no project, quit to shell.
          if (values.project) {
            setMode("dashboard");
          } else {
            finish({ kind: "quit" });
          }
        }}
      />
    );
  }

  if (mode === "provider") {
    return (
      <ListPicker
        title="Provider"
        items={providers.map((p) => ({
          id: p.id,
          label: p.label,
          sublabel: p.sublabel,
        }))}
        initialId={values.provider.id}
        onPick={(item) => {
          const provider = providers.find((p) => p.id === item.id)!;
          if (provider.secret && !getSecret(provider.secret.keychainService)) {
            setPendingProvider(provider);
            setMode("secret");
            return;
          }
          setValues((v) => ({ ...v, provider, model: "" }));
          setMode("dashboard");
        }}
        onCancel={() => setMode("dashboard")}
      />
    );
  }

  if (mode === "model") {
    const items = modelItems(values.provider);
    return (
      <ListPicker
        title="Model"
        items={items}
        initialId={values.model}
        onPick={(item) => {
          setValues((v) => ({ ...v, model: item.id }));
          setMode("dashboard");
        }}
        onCancel={() => setMode("dashboard")}
      />
    );
  }

  if (mode === "effort") {
    return (
      <ListPicker
        title="Effort"
        items={EFFORT_ITEMS}
        initialId={values.effort}
        onPick={(item) => {
          setValues((v) => ({
            ...v,
            effort: item.id as DashboardValues["effort"],
          }));
          setMode("dashboard");
        }}
        onCancel={() => setMode("dashboard")}
      />
    );
  }

  if (mode === "mode") {
    return (
      <ListPicker
        title="Permission mode"
        items={MODE_ITEMS}
        initialId={values.mode}
        onPick={(item) => {
          setValues((v) => ({ ...v, mode: item.id as PermissionMode }));
          setMode("dashboard");
        }}
        onCancel={() => setMode("dashboard")}
      />
    );
  }

  if (mode === "settings") {
    return (
      <SettingsScreen
        roots={roots}
        counts={{
          recents: state.recents.length,
          favorites: state.favorites.length,
          tints: countTints(state),
        }}
        onAction={handleSettingsAction}
        onCancel={() => {
          setProjectRev((r) => r + 1);
          setMode("dashboard");
        }}
      />
    );
  }

  if (mode === "secret" && pendingProvider?.secret) {
    return (
      <SecretPrompt
        providerLabel={pendingProvider.label}
        onSubmit={(v) => {
          setSecret(pendingProvider.secret!.keychainService, v);
          const nextValues = { ...values, provider: pendingProvider };
          setValues(nextValues);
          setPendingProvider(null);
          if (nextValues.project) {
            performLaunch(nextValues);
          } else {
            setMode("dashboard");
          }
        }}
        onCancel={() => {
          setPendingProvider(null);
          setMode("dashboard");
        }}
      />
    );
  }

  // Dashboard is the home screen. The `key` prop resets internal focus state
  // whenever the project changes — so right after picking a project, focus
  // jumps to the Launch row instead of sticking on the Project row.
  return (
    <Dashboard
      key={values.project?.path ?? "__none__"}
      values={values}
      recents={recents}
      vsCodeAvailable={vsCodeAvailable}
      projectColor={
        values.project
          ? state.perProject[values.project.path]?.color
          : undefined
      }
      onOpen={(field) => setMode(field as Mode)}
      onToggleVSCode={() =>
        setValues((v) => ({ ...v, openVSCode: !v.openVSCode }))
      }
      onLaunch={() => performLaunch(values)}
      onQuit={() => finish({ kind: "quit" })}
    />
  );
}
