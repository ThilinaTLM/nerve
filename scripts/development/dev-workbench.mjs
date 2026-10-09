import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  assertSlotPaths,
  createSlotParent,
  developmentEnvironment,
  resolveStorageSlot,
} from "./storage-slot.mjs";
import {
  assertPortFree,
  inspectSlotDaemon,
  preflightSlot,
} from "./slot-preflight.mjs";
import { runCommand, runOwned } from "./owned-processes.mjs";

try {
  const mode = process.argv[2];
  if (!["all", "ui"].includes(mode))
    throw new Error("Expected development mode all or ui.");
  const uiOnly = mode === "ui";
  const slot = resolveStorageSlot(process.argv.slice(3));
  const env = developmentEnvironment(slot, process.env, uiOnly);
  const options = { cwd: slot.repo, env };
  const external =
    uiOnly &&
    (process.env.NERVE_HOME?.trim() || process.env.NERVE_API_TARGET?.trim());
  if (!uiOnly || !process.env.NERVE_HOME?.trim()) await assertSlotPaths(slot);
  if (!uiOnly) {
    await createSlotParent(slot);
    await runCommand("pnpm", ["build:native"], options);
  }
  await runCommand(
    "pnpm",
    [
      "--filter",
      "@nervekit/contracts",
      "--filter",
      "@nervekit/protocol",
      "--filter",
      "@nervekit/harness",
      "--filter",
      "@nervekit/tools",
      ...(!uiOnly
        ? [
            "--filter",
            "@nervekit/skills",
            "--filter",
            "@nervekit/conversation-core",
          ]
        : []),
      "build",
    ],
    options,
  );
  let reused = false;
  if (uiOnly && !external) {
    if (!(await inspectSlotDaemon(slot))) {
      throw new Error(
        `No authenticated daemon is running for slot ${slot.slot}. Start pnpm dev or pnpm desktop:dev with this slot first.`,
      );
    }
  } else if (!uiOnly) {
    reused = await preflightSlot(slot);
    if (!reused) {
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
  }
  await assertPortFree(slot.uiPort);
  if (reused)
    console.log(
      "[nerve] Reusing the authenticated development daemon (not owned by this launch).",
    );
  console.log(`[nerve] UI home: ${env.NERVE_HOME}`);
  console.log(
    `[nerve] UI API target: ${env.NERVE_API_TARGET ?? "discovered from the selected home"}`,
  );
  console.log(`[nerve] UI http://127.0.0.1:${slot.uiPort}`);
  // Launch the long-running Node children directly, not via pnpm wrappers:
  // peer failure and signals must reach the actual server/Vite owners.
  const app = join(slot.repo, "packages/workbench-app");
  const appRequire = createRequire(join(app, "package.json"));
  const vite = join(
    dirname(appRequire.resolve("vite/package.json")),
    "bin/vite.js",
  );
  const commands = [
    [
      process.execPath,
      [vite, "--port", String(slot.uiPort), "--strictPort"],
      app,
    ],
  ];
  if (!uiOnly && !reused) {
    const server = join(slot.repo, "packages/workbench-server");
    const serverRequire = createRequire(join(server, "package.json"));
    commands.unshift([
      process.execPath,
      ["--import", serverRequire.resolve("tsx"), "src/main.ts"],
      server,
    ]);
  }
  await runOwned(commands, options);
} catch (error) {
  console.error(`[nerve] ${error.message}`);
  process.exitCode = 1;
}
