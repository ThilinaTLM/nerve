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

test("startup settles a completed approved tool without executing it again", async () => {
  const provider = "nerve-scripted-completed-approval-recovery";
  const root = await mkdtemp(join(tmpdir(), "nerve-completed-approval-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const marker = join(workspace, "executed-once");
  await mkdir(workspace);
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [
      {
        type: "toolCall",
        id: "completed_write_call",
        name: "write",
        args: { path: marker, content: "executed" },
      },
      { type: "text", text: "Recovered after the tool result." },
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
    const approval = await waitForValue(() =>
      runtime.services.tools
        .listApprovals("pending")
        .find((candidate) => candidate.conversationId === conversation.id),
    );

    await runtime.services.tools.decideApproval(approval.id, "allow");
    const completed = await runtime.services.tools.finalizeDecidedApproval(
      approval.id,
    );
    assert.equal(completed.status, "completed");
    assert.equal(await access(marker).then(() => true), true);
    await shutdownServerRuntime(runtime.runtime);

    runtime = createRuntimeFixture(
      await initializeStorage(home),
      "127.0.0.1",
      0,
    );
    await runtime.lifecycle.hydrate();
    await waitForValue(
      () => {
        const current = runtime.services.agentLifecycle.getAgent(agent.id);
        return current.status === "idle" || current.status === "error"
          ? current
          : undefined;
      },
      () =>
        JSON.stringify({
          agent: runtime.services.agentLifecycle.getAgent(agent.id),
          approvals: runtime.services.tools.listApprovals(),
          tools: runtime.services.tools.listToolCalls(),
        }),
    );
    const state = (await new WorkbenchRunUnitOfWork(home, 0).list()).find(
      (candidate) => candidate.run.conversationId === conversation.id,
    );
    assert.notEqual(state?.run.status, "waiting");
    assert.ok(state?.interactions.every((item) => item.status === "resolved"));
    assert.equal(
      (await runtime.services.tools.getToolCallDetails(approval.toolCallId))
        .status,
      "completed",
    );
    assert.equal(
      runtime.services.conversationLifecycle
        .getConversationEntries(conversation.id)
        .filter(
          (entry) =>
            (entry.details as { toolRecordId?: string } | undefined)
              ?.toolRecordId === approval.toolCallId,
        ).length,
      1,
    );
  } finally {
    registration.unregister();
    await shutdownServerRuntime(runtime.runtime).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function waitForValue<T>(
  read: () => T | undefined,
  diagnostics: () => string = () => "unavailable",
): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for recovered state: ${diagnostics()}`);
}
