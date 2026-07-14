import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import { SandboxRunUnitOfWork } from "../src/agent/run-transition-store.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

const config = {
  version: 1,
  identity: { sandboxId: "sbx_retry" },
  agent: {
    defaultModel: { provider: "nerve-scripted", model: "scripted-fast" },
  },
  controller: {
    websocket: { url: "ws://manager.invalid/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("sandbox coordinator-owned provider retry", () => {
  it("commits retrying and completes with a new execution attempt", async () => {
    const registration = registerAgentScriptedProvider({
      steps: [
        {
          type: "providerError",
          message: "provider returned error 503",
          retryable: true,
        },
        { type: "assistantText", text: "Recovered after retry." },
      ],
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-run-retry-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        config,
        "sha256:retry",
        "inst_retry",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const started = (await daemon.router.dispatch(
        "run.start",
        { text: "Retry once" },
        { idempotencyKey: "cmd_retry" },
      )) as { runId: string };
      const unitOfWork = new SandboxRunUnitOfWork(stores.stateDir);
      await waitFor(async () => {
        const state = await unitOfWork.load(started.runId);
        if (
          state?.run.status === "failed" ||
          state?.run.status === "interrupted"
        ) {
          throw new Error(
            `Retry settled as ${state.run.status}: ${state.run.failure?.message}`,
          );
        }
        return state?.run.status === "completed";
      });
      const state = await unitOfWork.load(started.runId);
      assert.equal(state?.run.attempt, 2);
      assert.equal(
        state?.transitions.filter(
          (transition) => transition.kind === "retrying",
        ).length,
        1,
      );
      const retry = state?.transitions
        .flatMap((transition) => transition.events)
        .find((event) => event.type === "run.retrying");
      assert.equal((retry?.data as { attempt?: number }).attempt, 1);
      assert.equal((retry?.data as { maxRetries?: number }).maxRetries, 3);
      assert.equal((retry?.data as { delayMs?: number }).delayMs, 2_000);
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for retried run");
}
