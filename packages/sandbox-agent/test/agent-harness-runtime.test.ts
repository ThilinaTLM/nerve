import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { sandboxEventPayloadSchemas } from "@nervekit/shared";
import { SandboxCommandError } from "../src/daemon/errors.js";
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
  it("starts a real harness turn and streams schema-valid events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-live-runtime-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        fauxConfig(),
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const result = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_live_1",
        prompt: "Say hello from the live harness",
      })) as { runId: string; status: string };
      assert.equal(result.status, "queued");

      const run = await waitForRun(daemon, result.runId, "completed");
      assert.equal(run.status, "completed");
      const events = stores.events.all();
      assert.ok(events.some((event) => event.type === "run.delta"));
      assert.ok(
        events.some((event) => event.type === "run.transcript.appended"),
      );
      assert.ok(events.some((event) => event.type === "run.completed"));
      for (const event of events) {
        const schema =
          sandboxEventPayloadSchemas[
            event.type as keyof typeof sandboxEventPayloadSchemas
          ];
        if (schema)
          assert.equal(schema.safeParse(event.data).success, true, event.type);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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
          daemon.router.dispatch("sandbox.run.start", {
            commandId: "cmd_no_auth",
            prompt: "hello",
          }),
        (error) =>
          error instanceof SandboxCommandError && error.code === "UNAVAILABLE",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function waitForRun(
  daemon: SandboxDaemon,
  runId: string,
  terminal: string,
): Promise<{ runId: string; status: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = (await daemon.router.dispatch("sandbox.status.get", {})) as {
      runs: Array<{ runId: string; status: string }>;
    };
    const run = status.runs.find((entry) => entry.runId === runId);
    if (run?.status === terminal) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${runId} to become ${terminal}`);
}
