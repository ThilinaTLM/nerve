import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/shared";
import { SandboxCommandError } from "../src/daemon/errors.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

const baseConfig = {
  version: 1,
  identity: { sandboxId: "sbx_cmd" },
  agent: { mainModel: { provider: "anthropic", model: "claude" } },
  controller: {
    websocket: { url: "ws://manager.invalid/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("sandbox daemon command semantics", () => {
  it("returns UI-ready status and snapshot contracts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-daemon-status-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        baseConfig,
        "sha256:test",
        "inst_1",
        stores,
      );
      daemon.start();
      const status = await daemon.router.dispatch("sandbox.status.get", {});
      assert.equal(
        sandboxStatusGetResultSchema.safeParse(status).success,
        true,
      );
      const snapshot = await daemon.router.dispatch("sandbox.snapshot.get", {});
      assert.equal(
        sandboxSnapshotResultSchema.safeParse(snapshot).success,
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires a run prompt unless the agent has an initial prompt", async () => {
    const daemon = new SandboxDaemon(baseConfig, "sha256:test", "inst_1");
    await assert.rejects(
      () => daemon.router.dispatch("sandbox.run.start", { commandId: "cmd_1" }),
      (error) =>
        error instanceof SandboxCommandError &&
        error.code === "VALIDATION_FAILED",
    );

    const withInitialPrompt = new SandboxDaemon(
      {
        ...baseConfig,
        agent: {
          ...baseConfig.agent,
          initialPrompt: "Use this fallback prompt",
        },
      },
      "sha256:test",
      "inst_2",
    );
    const result = (await withInitialPrompt.router.dispatch(
      "sandbox.run.start",
      {
        commandId: "cmd_2",
      },
    )) as { status?: string };
    assert.equal(result.status, "queued");
  });
});
