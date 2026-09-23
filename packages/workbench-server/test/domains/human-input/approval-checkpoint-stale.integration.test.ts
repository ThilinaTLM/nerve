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

test("a stale released checkpoint preserves completed siblings and fences unclaimed ones", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-released-stale-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const firstPath = join(workspace, "first.txt");
  const secondPath = join(workspace, "second.txt");
  const registration = registerAgentScriptedProvider({
    provider: "nerve-released-stale",
    steps: [
      {
        type: "toolCalls",
        calls: [
          {
            id: "first_write",
            name: "write",
            args: { path: firstPath, content: "first" },
          },
          {
            id: "second_write",
            name: "write",
            args: { path: secondPath, content: "second" },
          },
        ],
      },
      { type: "assistantText", text: "This continuation must never run." },
    ],
  });
  const runtime = createRuntimeFixture(
    await initializeStorage(home),
    "127.0.0.1",
    0,
  );
  let releaseClaim = () => {};
  try {
    await runtime.lifecycle.hydrate();
    const { services } = runtime;
    const project = await services.projectLifecycle.createProject({
      dir: workspace,
    });
    const conversation =
      await services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const agent = await services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "nerve-released-stale", modelId: "scripted-fast" },
      permissionLevel: "supervised",
      permissionRuleSetId: "supervised",
    });
    await services.workbenchRun.promptAgent(agent.id, {
      text: "Write two files.",
    });
    const approvals = await waitFor(() => {
      const found = services.tools
        .listApprovals("pending")
        .filter((candidate) => candidate.conversationId === conversation.id);
      return found.length === 2 ? found : undefined;
    });
    const [first, second] = approvals.map((approval) => approval.toolCallId);
    const completedPath = services.tools.getToolCall(first).args.path as string;
    const unclaimedPath = services.tools.getToolCall(second).args
      .path as string;
    const originalClaim = services.tools.claimApprovedExecution.bind(
      services.tools,
    );
    let enteredClaim = () => {};
    const claimEntered = new Promise<void>((resolve) => {
      enteredClaim = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    services.tools.claimApprovedExecution = ((id, assertContext) => {
      if (id !== second) return originalClaim(id, assertContext);
      enteredClaim();
      return blocked.then(() => originalClaim(id, assertContext));
    }) as typeof services.tools.claimApprovedExecution;
    for (const [index, id] of [first, second].entries()) {
      await services.humanInput.resolveApproval({
        toolCallId: id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: `request_stale_released_${index}`,
      });
    }
    await claimEntered;
    await waitFor(() =>
      services.tools.getToolCall(first).status === "completed"
        ? true
        : undefined,
    );
    await services.conversationLifecycle.appendEntry({
      conversationId: conversation.id,
      agentId: agent.id,
      role: "user",
      text: "Change branches while the second tool has not started.",
    });
    releaseClaim();
    await waitFor(async () => {
      const state = (await new WorkbenchRunUnitOfWork(home, 0).list()).find(
        (item) => item.run.conversationId === conversation.id,
      );
      return state?.run.status === "cancelled" ? state : undefined;
    });
    assert.equal(services.tools.getToolCall(first).status, "completed");
    assert.equal(services.tools.getToolCall(second).status, "cancelled");
    assert.match(
      services.tools.getToolCall(second).error ?? "",
      /no tool was executed|not executed/i,
    );
    await access(completedPath);
    await assert.rejects(access(unclaimedPath));
    assert.equal(
      services.conversationLifecycle
        .getConversationEntries(conversation.id)
        .some((entry) => entry.text === "This continuation must never run."),
      false,
    );
  } finally {
    releaseClaim();
    registration.unregister();
    await shutdownServerRuntime(runtime.runtime).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for released checkpoint state.");
}
