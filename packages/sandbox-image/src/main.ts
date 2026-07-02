#!/usr/bin/env node
import {
  runSandboxEntrypoint,
  sandboxEntrypointErrorMessage,
  sandboxEntrypointExitCode,
} from "./entrypoint.js";
import { sandboxHealthcheck } from "./healthcheck.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "healthcheck") {
    console.log(JSON.stringify(await sandboxHealthcheck()));
    return;
  }
  if (command === "--help" || command === "-h") {
    console.log("Usage: nerve-sandbox [healthcheck]");
    return;
  }
  const result = await runSandboxEntrypoint();
  console.log(
    JSON.stringify({
      status: result.status,
      configDigest: result.configDigest,
      configPath: result.configPath,
      stateDir: result.stateDir,
      workspaceDir: result.workspaceDir,
    }),
  );
}

main().catch((error) => {
  console.error(sandboxEntrypointErrorMessage(error));
  process.exitCode = sandboxEntrypointExitCode(error);
});
