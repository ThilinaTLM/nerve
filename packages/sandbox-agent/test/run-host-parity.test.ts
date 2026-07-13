import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  runRealHostCompletionScenario,
  type RealHostRunScenarioFixture,
} from "@nervekit/host-runtime/test-support";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import { SandboxRunUnitOfWork } from "../src/agent/run-transition-store.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

const config = {
  version: 1,
  identity: { sandboxId: "sbx_parity" },
  agent: {
    defaultModel: {
      provider: "nerve-scripted-parity",
      model: "scripted-fast",
    },
  },
  controller: {
    websocket: { url: "ws://manager.invalid/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("sandbox real-host run parity", () => {
  it("passes the shared durable completion scenario", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-sandbox-parity-"));
    let registration = registerAgentScriptedProvider({
      provider: "nerve-scripted-parity",
      steps: [
        { type: "assistantText", text: "Parity response. ".repeat(400) },
        ...Array.from({ length: 5 }, () => ({
          type: "assistantText" as const,
          text: "Parity response.",
        })),
      ],
    });
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        config,
        "sha256:parity",
        "inst_parity",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const unitOfWork = new SandboxRunUnitOfWork(stores.stateDir);
      const fixture: RealHostRunScenarioFixture = {
        start: async (prompt, images) => {
          const result = (await daemon.router.dispatch("run.start", {
            requestId: "cmd_parity_completion",
            text: prompt,
            images,
          })) as { runId: string };
          return result.runId;
        },
        steer: async (runId, text, images) => {
          const state = await unitOfWork.load(runId);
          if (!state) throw new Error(`Missing run ${runId}`);
          await daemon.router.dispatch("run.steer", {
            requestId: `cmd_steer_${state.run.attempt}`,
            conversationId: state.run.conversationId,
            agentId: state.run.agentId,
            runId,
            text,
            images,
          });
        },
        followUp: async (runId, text, images) => {
          const state = await unitOfWork.load(runId);
          if (!state) throw new Error(`Missing run ${runId}`);
          await daemon.router.dispatch("run.followUp", {
            requestId: `cmd_follow_${state.run.attempt}`,
            conversationId: state.run.conversationId,
            agentId: state.run.agentId,
            runId,
            text,
            images,
          });
        },
        cancel: async (runId) => {
          const state = await unitOfWork.load(runId);
          if (!state) throw new Error(`Missing run ${runId}`);
          await daemon.router.dispatch("run.cancel", {
            requestId: `cmd_cancel_${state.run.attempt}`,
            conversationId: state.run.conversationId,
            agentId: state.run.agentId,
            runId,
          });
        },
        waitForTerminal: async (runId) => {
          await waitFor(async () => {
            const state = await unitOfWork.load(runId);
            return ["completed", "failed", "cancelled"].includes(
              state?.run.status ?? "",
            );
          });
        },
        load: (runId) => unitOfWork.load(runId),
        snapshot: async (runId) => {
          const [response, state] = await Promise.all([
            daemon.router.dispatch("sandbox.conversation.snapshot.get", {
              runId,
            }) as Promise<{
              snapshot?: {
                entries: Array<{ id: string; role: string; text: string }>;
                toolCalls: Array<{ id: string; status: string }>;
              };
            }>,
            unitOfWork.load(runId),
          ]);
          return {
            runId,
            status: state?.run.status ?? "missing",
            entries: (response.snapshot?.entries ?? []).map((entry) => ({
              id: entry.id,
              role: entry.role,
              text: entry.text,
            })),
            toolCalls: (response.snapshot?.toolCalls ?? []).map((toolCall) => ({
              id: toolCall.id,
              status: toolCall.status,
            })),
          };
        },
        prepareCancellation: async () => {
          registration.unregister();
          registration = registerAgentScriptedProvider({
            provider: "nerve-scripted-parity",
            steps: [{ type: "waitForAbort" }],
          });
        },
        durableEventTypes: async (runId) => {
          await waitFor(async () =>
            stores.events
              .all()
              .some(
                (event) =>
                  event.type === "run.completed" &&
                  (event.data as { runId?: string }).runId === runId,
              ),
          );
          return stores.events
            .all()
            .filter(
              (event) =>
                event.durability === "durable" &&
                (event.data as { runId?: string }).runId === runId,
            )
            .map((event) => event.type);
        },
      };
      const result = await runRealHostCompletionScenario(fixture);
      assert.equal(result.snapshot.status, "completed");
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
  throw new Error("Timed out waiting for terminal run state");
}
