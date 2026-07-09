#!/usr/bin/env node
import { createLogger } from "@nervekit/shared";
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
    console.log("Usage: nerve-sandbox-agent [healthcheck]");
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
  const exitCode = sandboxEntrypointExitCode(error);
  createLogger({
    base: {
      source: "sandbox-agent",
      component: "startup",
      sandboxId: process.env.NERVE_SANDBOX_ID,
      instanceId: process.env.NERVE_SANDBOX_AGENT_INSTANCE_ID,
    },
  }).error("sandbox-agent startup failed", {
    exitCode,
    failure: {
      code: error instanceof Error ? error.name || "ERROR" : "ERROR",
      message: sandboxEntrypointErrorMessage(error),
    },
  });
  process.exitCode = exitCode;
});
