import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "./Header.tsx";
import { basename } from "node:path";
import { projectDisplay, type Project } from "../projects.ts";
import type { Provider } from "../providers.ts";
import type { PermissionMode } from "../launch.ts";

export type DashboardValues = {
  project: Project | null;
  provider: Provider;
  // Claude: "" = Opus (default), "sonnet" = Sonnet.
  // Providers with models list: concrete id (or "" = first model).
  model: string;
  effort: "default" | "low" | "medium" | "high" | "xhigh" | "max";
  mode: PermissionMode;
  openVSCode: boolean;
};

type FieldId =
  | "project"
  | "provider"
  | "model"
  | "mode"
  | "effort"
  | "vscode"
  | "settings"
  | "launch";

type Props = {
  values: DashboardValues;
  recents: Project[];
  vsCodeAvailable: boolean;
  projectColor?: string;
  focusField?: FieldId;
  onFocusChange?: (field: FieldId) => void;
  onOpen: (field: Exclude<FieldId, "vscode" | "launch">) => void;
  onToggleVSCode: () => void;
  onLaunch: () => void;
  onQuit: () => void;
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const effortLabel = (e: DashboardValues["effort"]) =>
  e === "default" ? "Medium" : cap(e);

const MODE_DISPLAY: Record<PermissionMode, string> = {
  bypassPermissions: "Bypass",
  auto: "Auto",
  acceptEdits: "Accept edits",
  plan: "Plan",
  default: "Ask each time",
};

function modelLabel(provider: Provider, model: string): string {
  if (provider.supportsClaudeFlags) {
    return model === "sonnet" ? "Sonnet" : "Opus";
  }
  if (provider.models?.length) {
    const id = model || provider.models[0].id;
    const item = provider.models.find((m) => m.id === id) ?? provider.models[0];
    return item.label;
  }
  return "—";
}

export function Dashboard({
  values,
  recents,
  vsCodeAvailable,
  projectColor,
  focusField,
  onFocusChange,
  onOpen,
  onToggleVSCode,
  onLaunch,
  onQuit,
}: Props) {
  const hasModelPicker =
    !!values.provider.supportsClaudeFlags || !!values.provider.models?.length;
  const hasEffortPicker = !!values.provider.supportsClaudeFlags;

  const fields: FieldId[] = [
    "project",
    "provider",
    ...(hasModelPicker ? (["model"] as const) : []),
    "mode",
    ...(hasEffortPicker ? (["effort"] as const) : []),
    ...(vsCodeAvailable ? (["vscode"] as const) : []),
    "settings",
    "launch",
  ];

  // Focus is controlled by the parent (App) when `focusField` is supplied, so
  // returning from a picker lands on the row the user edited instead of
  // resetting. Fallback: uncontrolled — Launch if a project exists, else
  // Project.
  const [localFocus, setLocalFocus] = useState<number>(
    values.project ? fields.indexOf("launch") : fields.indexOf("project"),
  );
  const focus =
    focusField !== undefined
      ? Math.max(0, fields.indexOf(focusField))
      : localFocus;
  const safeFocus = Math.min(focus, fields.length - 1);

  const setFocus = (next: number) => {
    const clamped = Math.max(0, Math.min(fields.length - 1, next));
    setLocalFocus(clamped);
    onFocusChange?.(fields[clamped]);
  };

  useInput((input, key) => {
    if (key.escape) return onQuit();
    if (key.upArrow)
      return setFocus(safeFocus === 0 ? fields.length - 1 : safeFocus - 1);
    if (key.downArrow || key.tab)
      return setFocus((safeFocus + 1) % fields.length);
    const field = fields[safeFocus];
    if (key.return) {
      if (field === "launch") {
        if (values.project) onLaunch();
        return;
      }
      if (field === "vscode") return onToggleVSCode();
      onOpen(field);
    }
    if (input === " " && field === "vscode") onToggleVSCode();
  });

  const projectValue = values.project
    ? projectDisplay(values.project)
    : "— pick a project —";
  const providerValue = `${values.provider.label}${
    values.provider.sublabel ? ` · ${values.provider.sublabel}` : ""
  }`;
  const launchActive = fields[safeFocus] === "launch";
  const canLaunch = !!values.project;

  // Each row is split into [prefix][value][tail] so the project row can
  // apply a per-project bg tint to just the value — like the CC statusline
  // pill — without breaking the full-width active-row highlight.
  type RowSpec = {
    id: FieldId;
    prefix: string;
    value: string;
    tintColor?: string;
  };
  const specs: RowSpec[] = [];
  const addRow = (id: FieldId, label: string, value: string, tint?: string) => {
    const arrow = fields[safeFocus] === id ? "▸" : " ";
    specs.push({
      id,
      prefix: ` ${arrow}  ${label.padEnd(12)}`,
      value: ` ${value} `,
      tintColor: tint,
    });
  };
  addRow("project", "Project", projectValue, projectColor);
  addRow("provider", "Provider", providerValue);
  if (hasModelPicker)
    addRow("model", "Model", modelLabel(values.provider, values.model));
  addRow("mode", "Mode", MODE_DISPLAY[values.mode]);
  if (hasEffortPicker) addRow("effort", "Effort", effortLabel(values.effort));
  if (vsCodeAvailable)
    addRow("vscode", "VS Code", values.openVSCode ? "◉ also open" : "○ skip");
  addRow("settings", "Settings", "⚙ roots, clear state…");

  const rowMaxLen = Math.max(
    ...specs.map((s) => s.prefix.length + s.value.length),
  );

  return (
    <Box flexDirection="column">
      <Header
        title=""
        hint="↑↓ move · ⏎ edit/launch · space toggle · esc shell"
      />
      {specs.map((s) => {
        const active = fields[safeFocus] === s.id;
        const tail = " ".repeat(
          rowMaxLen - s.prefix.length - s.value.length + 2,
        );
        const activeBg = active ? "magenta" : undefined;
        const activeFg = active ? "white" : undefined;
        return (
          <Box key={s.id}>
            <Text backgroundColor={activeBg} color={activeFg} bold={active}>
              {s.prefix}
            </Text>
            {/* Pill slot is ALWAYS 2 chars wide for uniform row alignment —
                bg is the tint color when set, otherwise matches the row's
                active-or-default bg so it disappears. */}
            <Text backgroundColor={s.tintColor ?? activeBg}>{"  "}</Text>
            <Text
              backgroundColor={active ? "magenta" : s.tintColor}
              color={active ? "white" : s.tintColor ? "white" : undefined}
              bold={active}
            >
              {s.value}
            </Text>
            <Text backgroundColor={activeBg} color={activeFg}>
              {tail}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text
          backgroundColor={launchActive ? "green" : undefined}
          color={launchActive ? "black" : canLaunch ? "green" : undefined}
          bold
          dimColor={!canLaunch && !launchActive}
        >
          {` ${launchActive ? "▸" : " "}  [ Launch ] `}
        </Text>
      </Box>
      {recents.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            recent:{" "}
            {recents
              .slice(0, 5)
              .map((r) => basename(r.path))
              .join(" · ")}
          </Text>
        </Box>
      )}
    </Box>
  );
}
