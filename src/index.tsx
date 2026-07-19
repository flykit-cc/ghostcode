import React from "react";
import { render } from "ink";
import { App, type Outcome } from "./ui/App.tsx";
import { runLaunch } from "./launch.ts";
import { spawnSync } from "node:child_process";
import pkg from "../package.json" with { type: "json" };

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(pkg.version);
  process.exit(0);
}

if (process.argv[2] === "report") {
  const { runReport } = await import("./tracker/report-cli.ts");
  process.exit(runReport(process.argv.slice(3)));
}

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
  const code = await runLaunch({
    projectPath: values.project.path,
    provider: values.provider,
    secretValue,
    model: values.model,
    effort: values.effort,
    mode: values.mode,
    openVSCode: values.openVSCode,
  });
  process.exit(code);
}

main();
