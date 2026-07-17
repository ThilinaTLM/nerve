import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxConfigV1 } from "@nervekit/contracts";
import { sandboxDaemonCapabilities } from "../src/protocol/sandbox-protocol-client.js";

test("sandbox capabilities advertise remotely handled operations", () => {
  const capabilities = sandboxDaemonCapabilities({
    controller: {},
  } as SandboxConfigV1);

  assert.ok(capabilities.includes("operation.sandbox.status.get"));
  assert.ok(capabilities.includes("operation.run.start"));
});
