import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SandboxOperationError } from "../src/daemon/errors.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

function fauxConfig() {
  return {
    version: 1,
    identity: { sandboxId: "sbx_live" },
    agent: { defaultModel: { provider: "nerve-faux", model: "faux-fast" } },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
  } as const;
}

describe("sandbox live AgentHarness runtime", () => {
  it("rejects starts for auth-backed providers without a configured credential", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-live-runtime-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        {
          ...fauxConfig(),
          agent: {
            defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
          },
        } as never,
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      await assert.rejects(
        () =>
          daemon.router.dispatch("run.start", {
            requestId: "cmd_no_auth",
            text: "hello",
          }),
        (error) =>
          error instanceof SandboxOperationError &&
          error.code === "UNAVAILABLE",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
