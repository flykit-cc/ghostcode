import React from "react";
import { render } from "ink";
import { App, type Outcome } from "./ui/App.tsx";
import { runLaunch } from "./launch.ts";
import { spawnSync } from "node:child_process";

async function main() {
  const outcome = await new Promise<Outcome>((resolve) => {
    const { unmount, waitUntilExit } = render(
      <App onDone={(o) => resolved(o)} />,
      {
        exitOnCtrlC: true,
      },
    );
    let settled = false;
    function resolved(o: Outcome) {
      if (settled) return;
      settled = true;
      unmount();
      resolve(o);
    }
    waitUntilExit().then(() => {
      if (!settled) {
        settled = true;
        resolve({ kind: "quit" });
      }
    });
  });

  // Clear the Ink frame so the terminal starts clean.
  process.stdout.write("\x1b[2J\x1b[H");

  if (outcome.kind === "quit") {
    const zsh = spawnSync("zsh", [], { stdio: "inherit" });
    process.exit(zsh.status ?? 0);
  }

  const { values, secretValue } = outcome;
  if (!values.project) {
    process.exit(0);
  }
  process.exit(
    runLaunch({
      projectPath: values.project.path,
      provider: values.provider,
      secretValue,
      model: values.model,
      effort: values.effort,
      mode: values.mode,
      openVSCode: values.openVSCode,
    }),
  );
}

main();
