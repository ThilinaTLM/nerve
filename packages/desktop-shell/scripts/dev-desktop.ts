import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CliError, defineCli } from "../../../scripts/cli/main.ts";
import {
  assertSlotPaths,
  createSlotParent,
  developmentEnvironment,
  resolveStorageSlot,
} from "../../../scripts/development/storage-slot.ts";
import { preflightSlot } from "../../../scripts/development/slot-preflight.ts";
import { runCommand } from "../../../scripts/development/owned-processes.ts";

async function main(args: string[]): Promise<void> {
  const slot = resolveStorageSlot(args);
  // Only this launcher labels the desktop UI as a development instance.
  const env = {
    ...developmentEnvironment(slot),
    NERVE_DESKTOP_DEV_SLOT: String(slot.slot),
  };
  const options = { cwd: slot.repo, env };
  await createSlotParent(slot);
  await runCommand("pnpm", ["-w", "build:native"], options);
  await runCommand("pnpm", ["-w", "build:workbench-runtime"], options);
  await runCommand(
    "pnpm",
    ["--filter", "@nervekit/desktop-shell", "build"],
    options,
  );
  const reused = await preflightSlot(slot);
  if (reused) {
    console.log(
      "[nerve] Reusing the authenticated development daemon (not owned by this launch).",
    );
  } else {
    await runCommand(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/development/prepare-slot.ts",
        "--slot",
        String(slot.slot),
      ],
      options,
    );
  }
  await assertSlotPaths(slot);
  await mkdir(slot.profile, { recursive: true, mode: 0o700 });
  await assertSlotPaths(slot);
  console.log(`[nerve] development home: ${slot.home}`);
  console.log(`[nerve] Electron profile: ${slot.profile}`);
  console.log(`[nerve] HTTP ${slot.httpPort}, mobile HTTPS ${slot.httpsPort}`);
  await runCommand(
    process.execPath,
    [
      fileURLToPath(new URL("start-electron.ts", import.meta.url)),
      "--local",
      "--host",
      "127.0.0.1",
      "--port",
      String(slot.httpPort),
      "--https-port",
      String(slot.httpsPort),
      "--mobile-https",
    ],
    options,
  );
}

await defineCli(import.meta.url, async (args) => {
  try {
    await main(args);
  } catch (error) {
    throw new CliError(`[nerve] ${(error as Error).message}`, {
      cause: error,
    });
  }
});
