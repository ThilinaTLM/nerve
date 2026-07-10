import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/agent";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

function config(provider: string) {
  return {
    version: 1,
    identity: { sandboxId: "sbx_plan" },
    agent: {
      defaultMode: "planning",
      defaultModel: { provider, model: "scripted-fast" },
    },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
    tools: { groups: { planMode: { enabled: true } } },
  } as const;
}

describe("sandbox plan-mode HIL", () => {
  it("recovers a review, requests changes, then accepts and continues", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-plan-hil-"));
    const planDir = path.join(dir, "plans");
    const planPath = path.join(planDir, "feature.md");
    await mkdir(planDir, { recursive: true });
    await writeFile(planPath, "# Feature plan\n\n1. Implement it.\n");
    const provider = "nerve-scripted-plan-hil";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "plan_1",
          name: "plan_mode_present",
          args: { file_path: planPath, title: "Feature plan" },
        },
        {
          type: "toolCall",
          id: "plan_2",
          name: "plan_mode_present",
          args: { file_path: planPath, title: "Feature plan revised" },
        },
        { type: "assistantText", text: "Implementing the accepted plan." },
      ],
    });
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        config(provider),
        "sha256:test",
        { sandboxId: "sbx_plan", instanceId: "inst_plan_1" },
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const start = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_plan_start",
        prompt: "Prepare and present the plan",
      })) as { conversationId: string; agentId: string; runId: string };
      const first = await waitForPlanReview(daemon, start.runId, "plan_1");

      const recoveredStores = new SandboxStateStores(dir);
      await recoveredStores.load();
      const recovered = new SandboxDaemon(
        config(provider),
        "sha256:test",
        { sandboxId: "sbx_plan", instanceId: "inst_plan_2" },
        recoveredStores,
        { workspaceDir: process.cwd() },
      );
      recovered.start();
      await recovered.router.dispatch("sandbox.planReview.resolve", {
        commandId: "cmd_plan_changes",
        conversationId: start.conversationId,
        agentId: start.agentId,
        runId: start.runId,
        reviewId: first.reviewId,
        decision: "request_changes",
        feedback: "Clarify the implementation step.",
      });
      const second = await waitForPlanReview(recovered, start.runId, "plan_2");
      await recovered.router.dispatch("sandbox.planReview.resolve", {
        commandId: "cmd_plan_accept",
        conversationId: start.conversationId,
        agentId: start.agentId,
        runId: start.runId,
        reviewId: second.reviewId,
        decision: "accept",
        implementationThinkingLevel: "high",
      });
      await waitForRun(recovered, start.runId, "completed");

      const status = (await recovered.router.dispatch(
        "sandbox.status.get",
        {},
      )) as {
        agentConfig?: { mode?: string; model?: { thinkingLevel?: string } };
      };
      assert.equal(status.agentConfig?.mode, "coding");
      assert.equal(status.agentConfig?.model?.thinkingLevel, "high");

      const conversation = await readFile(
        path.join(
          dir,
          "conversations",
          start.conversationId,
          "agents",
          start.agentId,
          "conversation.jsonl",
        ),
        "utf8",
      );
      assert.match(conversation, /"toolCallId":"plan_1"/);
      assert.match(conversation, /"status":"changes_requested"/);
      assert.match(conversation, /"toolCallId":"plan_2"/);
      assert.match(conversation, /"status":"accepted"/);
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects plan files outside sandbox plan storage", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-plan-path-"));
    const outside = path.join(dir, "outside.md");
    await writeFile(outside, "# Outside\n");
    const provider = "nerve-scripted-plan-path";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "plan_outside",
          name: "plan_mode_present",
          args: { file_path: outside },
        },
      ],
    });
    try {
      const stores = new SandboxStateStores(path.join(dir, "state"));
      await stores.load();
      const daemon = new SandboxDaemon(
        config(provider),
        "sha256:test",
        { sandboxId: "sbx_plan", instanceId: "inst_plan_path" },
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const start = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_plan_outside",
        prompt: "Present outside plan",
      })) as { runId: string };
      await waitForRun(daemon, start.runId, "completed");
      const snapshot = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        { runId: start.runId },
      )) as {
        snapshot?: { toolCalls?: Array<{ toolName: string; status: string }> };
      };
      assert.equal(
        snapshot.snapshot?.toolCalls?.find(
          (tool) => tool.toolName === "plan_mode_present",
        )?.status,
        "error",
      );
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function waitForPlanReview(
  daemon: SandboxDaemon,
  runId: string,
  providerToolCallId: string,
): Promise<{ reviewId: string }> {
  const deadline = Date.now() + 5_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const status = (await daemon.router.dispatch("sandbox.status.get", {})) as {
      runs: Array<{
        runId: string;
        waits?: Array<{
          waitId: string;
          kind: string;
          status: string;
          toolCallId?: string;
        }>;
      }>;
    };
    last = status.runs.find((run) => run.runId === runId);
    const wait = status.runs
      .find((run) => run.runId === runId)
      ?.waits?.find(
        (candidate) =>
          candidate.kind === "plan_review" &&
          candidate.status === "waiting" &&
          candidate.toolCallId === providerToolCallId,
      );
    if (wait) return { reviewId: wait.waitId };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${providerToolCallId}; last=${JSON.stringify(last)}`,
  );
}

async function waitForRun(
  daemon: SandboxDaemon,
  runId: string,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = (await daemon.router.dispatch("sandbox.status.get", {})) as {
      runs: Array<{ runId: string; status: string }>;
    };
    if (status.runs.find((run) => run.runId === runId)?.status === expected)
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${runId} to become ${expected}`);
}
