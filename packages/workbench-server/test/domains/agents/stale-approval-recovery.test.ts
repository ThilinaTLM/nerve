import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { WorkbenchRunUnitOfWork } from "../../../src/domains/runs/persistence/run-transition.repository.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

test("a stale decided approval is cancelled durably across restarts without tool execution", async () => {
  const provider = "nerve-scripted-stale-approval";
  const root = await mkdtemp(join(tmpdir(), "nerve-stale-approval-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const marker = join(workspace, "stale-tool-executed");
  await mkdir(workspace);
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [
      {
        type: "toolCall",
        id: "stale_write_call",
        name: "write",
        args: { path: marker, content: "executed" },
      },
    ],
  });
  let runtime = createRuntimeFixture(
    await initializeStorage(home),
    "127.0.0.1",
    0,
  );
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: workspace,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const agent = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "scripted-fast" },
      permissionLevel: "supervised",
      permissionRuleSetId: "supervised",
    });

    await runtime.services.workbenchRun.promptAgent(agent.id, {
      text: "Request the scripted tool.",
    });
    const approval = await waitForValue(
      () =>
        runtime.services.tools
          .listApprovals("pending")
          .find((candidate) => candidate.conversationId === conversation.id),
      () =>
        JSON.stringify({
          agent: runtime.services.agentLifecycle.getAgent(agent.id),
          tools: runtime.services.tools.listToolCalls(),
          approvals: runtime.services.tools.listApprovals(),
          entries:
            runtime.services.conversationLifecycle.getConversationEntries(
              conversation.id,
            ),
        }),
    );
    const toolCallId = approval.toolCallId;

    await runtime.services.conversationLifecycle.appendEntry({
      conversationId: conversation.id,
      agentId: agent.id,
      role: "user",
      text: "Move the active branch after the approval checkpoint.",
    });
    await assert.rejects(
      runtime.services.humanInput.resolveApproval(approval.id, "allow"),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "RUN_CHECKPOINT_STALE",
    );
    await assertNoFile(marker);
    await shutdownServerRuntime(runtime.runtime);

    runtime = createRuntimeFixture(
      await initializeStorage(home),
      "127.0.0.1",
      0,
    );
    await runtime.lifecycle.hydrate();
    const unitOfWork = new WorkbenchRunUnitOfWork(home, 0);
    const recovered = (await unitOfWork.list()).find(
      (state) => state.run.conversationId === conversation.id,
    );
    assert.equal(recovered?.run.status, "cancelled");
    assert.ok(
      recovered?.interactions.every(
        (interaction) => interaction.status === "cancelled",
      ),
    );
    assert.equal(
      (await runtime.services.tools.getToolCallDetails(toolCallId)).status,
      "cancelled",
    );
    await assertNoFile(marker);
    const entriesAfterRecovery =
      await runtime.services.conversationLifecycle.getConversationEntries(
        conversation.id,
      );
    assert.equal(
      entriesAfterRecovery.at(-1)?.text,
      "Move the active branch after the approval checkpoint.",
    );
    await shutdownServerRuntime(runtime.runtime);

    runtime = createRuntimeFixture(
      await initializeStorage(home),
      "127.0.0.1",
      0,
    );
    await runtime.lifecycle.hydrate();
    const repeated = (await new WorkbenchRunUnitOfWork(home, 0).list()).find(
      (state) => state.run.conversationId === conversation.id,
    );
    assert.equal(repeated?.run.status, "cancelled");
    assert.equal(
      repeated?.transitions.filter(
        (transition) => transition.kind === "cancellation_requested",
      ).length,
      1,
    );
    await assertNoFile(marker);
  } finally {
    registration.unregister();
    await shutdownServerRuntime(runtime.runtime).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function waitForValue<T>(
  read: () => T | undefined,
  diagnostics: () => string,
): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for value: ${diagnostics()}`);
}

async function assertNoFile(path: string): Promise<void> {
  await assert.rejects(access(path));
}
