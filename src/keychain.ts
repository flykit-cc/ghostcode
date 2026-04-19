import { spawnSync } from "node:child_process";

const ACCOUNT = "ghostcode";

export function getSecret(service: string): string | null {
  const r = spawnSync(
    "security",
    ["find-generic-password", "-a", ACCOUNT, "-s", service, "-w"],
    {
      encoding: "utf8",
    },
  );
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

export function setSecret(service: string, value: string): void {
  spawnSync(
    "security",
    ["add-generic-password", "-U", "-a", ACCOUNT, "-s", service, "-w", value],
    { encoding: "utf8" },
  );
}
