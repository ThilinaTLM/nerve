import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_RESOURCE_LIMITS } from "@nervekit/contracts/settings";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

test("concurrent approvals return on persistence while unrelated model work never finishes", async () => {
  const blockerProvider = "nerve-scripted-checkpoint-blocker";
  const provider = "nerve-scripted-checkpoint";
  const root = await mkdtemp(join(tmpdir(), "nerve-approval-checkpoint-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const files = ["one", "two", "three"].map((name) =>
    join(workspace, `${name}.txt`),
  );
  const blocker = registerAgentScriptedProvider({
    provider: blockerProvider,
    steps: [{ type: "waitForAbort" }],
  });
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [
      {
        type: "toolCalls",
        calls: files.map((path, index) => ({
          id: `write_call_${index}`,
          name: "write",
          args: { path, content: `written ${index}` },
        })),
      },
      { type: "assistantText", text: "All three writes finished." },
    ],
  });
  const runtime = createRuntimeFixture(
    await initializeStorage(home),
    "127.0.0.1",
    0,
    {
      // One model slot stays blocked by the unrelated conversation forever.
      resources: {
        ...DEFAULT_RESOURCE_LIMITS,
        maxConcurrentModelRuns: 2,
        controlWorkConcurrency: 4,
      },
    },
  );
  let blockedAgentId: string | undefined;
  try {
    await runtime.lifecycle.hydrate();
    const { services } = runtime;
    const project = await services.projectLifecycle.createProject({
      dir: workspace,
    });
    const blockedConversation =
      await services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const blockedAgent = await services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: blockedConversation.id,
      model: { provider: blockerProvider, modelId: "scripted-fast" },
    });
    blockedAgentId = blockedAgent.id;
    await services.workbenchRun.promptAgent(blockedAgent.id, {
      text: "Block a model slot.",
    });

    const conversation =
      await services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const agent = await services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "scripted-fast" },
      permissionLevel: "supervised",
      permissionRuleSetId: "supervised",
    });
    await services.workbenchRun.promptAgent(agent.id, {
      text: "Write the three files.",
    });
    const approvals = await waitFor(() => {
      const pending = services.tools
        .listApprovals("pending")
        .filter((approval) => approval.conversationId === conversation.id);
      return pending.length === 3 ? pending : undefined;
    });

    const receipts = await Promise.all(
      approvals.map((approval, index) => {
        const toolCall = services.tools.getToolCall(approval.toolCallId);
        return services.toolInteractions.resolve({
          toolCallId: toolCall.id,
          interactionOrdinal: 0,
          expectedRevision: toolCall.revision,
          resolutionRequestId: `request_${index}`,
          resolution: { kind: "approval", action: "allow" },
        });
      }),
    );
    // Each response acknowledges its decision, not the tool's execution.
    for (const receipt of receipts) {
      assert.equal(receipt.toolCall.status, "committed");
      assert.ok(receipt.checkpoint);
    }

    await waitFor(
      () =>
        services.agentLifecycle.getAgent(agent.id).status === "idle"
          ? true
          : undefined,
      () => ({
        agent: services.agentLifecycle.getAgent(agent.id).status,
        tools: services.tools
          .listToolCalls()
          .map((toolCall) => [toolCall.id, toolCall.status, toolCall.error]),
      }),
    );
    for (const [index, path] of files.entries()) {
      assert.equal(await readFile(path, "utf8"), `written ${index}`);
    }
    for (const approval of approvals) {
      const toolCall = await services.tools.getToolCallDetails(
        approval.toolCallId,
      );
      assert.equal(toolCall.status, "completed");
      assert.equal(toolCall.attempt, 1);
    }
    const run = (await services.runRuntime.unitOfWork.listMetadata()).find(
      (candidate) => candidate.conversationId === conversation.id,
    );
    const state = await services.runRuntime.unitOfWork.loadFresh(run!.runId);
    const kinds = state!.transitions.map((transition) => transition.kind);
    assert.equal(
      kinds.filter((kind) => kind === "approval_checkpoint_released").length,
      1,
    );
    assert.equal(
      kinds.filter((kind) => kind === "approval_checkpoint_settled").length,
      1,
    );
    const resultEntries = services.conversationLifecycle
      .getConversationEntries(conversation.id)
      .filter((entry) =>
        approvals.some(
          (approval) =>
            (entry.details as { toolRecordId?: string } | undefined)
              ?.toolRecordId === approval.toolCallId,
        ),
      );
    assert.equal(resultEntries.length, 3);
    assert.equal(
      services.agentLifecycle.getAgent(blockedAgent.id).status,
      "running",
    );
  } finally {
    // Shutdown drains lifecycle work, so release the deliberately blocked run.
    if (blockedAgentId) {
      await runtime.services.workbenchRun
        .abortAgent(blockedAgentId)
        .catch(() => undefined);
    }
    blocker.unregister();
    registration.unregister();
    await shutdownServerRuntime(runtime.runtime).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function waitFor<T>(
  read: () => T | undefined,
  diagnostics: () => unknown = () => "",
): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for approval checkpoint state: ${JSON.stringify(diagnostics())}`,
  );
}
