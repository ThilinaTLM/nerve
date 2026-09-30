import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { WorkbenchRunUnitOfWork } from "../../../src/domains/runs/persistence/run-transition.repository.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

for (const scenario of [
  { failures: 1, restart: false, stale: false },
  { failures: 2, restart: true, stale: false },
  { failures: 1, restart: false, stale: true },
]) {
  test(`retry approval: ${scenario.failures} failures, restart=${scenario.restart}, stale=${scenario.stale}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-retry-approval-"));
    const home = join(root, "home");
    const output = join(root, "approved.txt");
    const registration = registerAgentScriptedProvider({
      steps: [
        ...Array.from({ length: scenario.failures }, () => ({
          type: "providerError" as const,
          message: "provider returned error 503: overloaded",
          retryable: true,
        })),
        {
          type: "toolCalls",
          calls: [
            {
              id: "approved_write",
              name: "write",
              args: { path: output, content: "approved once" },
            },
          ],
        },
        { type: "assistantText", text: "Finished after approval." },
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
        dir: root,
      });
      const conversation =
        await runtime.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const agent = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: "nerve-scripted", modelId: "scripted-fast" },
        permissionLevel: "supervised",
        permissionRuleSetId: "supervised",
      });
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: "Write a file after retry.",
      });
      await waitFor(async () =>
        runtime.services.tools
          .listApprovals("pending")
          .some((item) => item.conversationId === conversation.id),
      );
      const approval = runtime.services.tools
        .listApprovals("pending")
        .find((item) => item.conversationId === conversation.id)!;
      const unitOfWork = new WorkbenchRunUnitOfWork(home, 0);
      const state = (await unitOfWork.list()).find(
        (item) => item.run.agentId === agent.id,
      )!;
      assert.equal(state.run.attempt, scenario.failures + 1);
      const abandoned = state.transitions
        .flatMap((transition) => transition.entries)
        .filter(
          (entry) =>
            (entry.details as { stopReason?: string } | undefined)
              ?.stopReason === "error",
        );
      assert.equal(abandoned.length, scenario.failures);
      const checkpoint = state.checkpoints.find(
        (item) => item.checkpointId === state.run.lastCheckpointId,
      )!;
      assert.ok(checkpoint.entryIds.length > 0);
      for (const entry of abandoned)
        assert.ok(!checkpoint.entryIds.includes(entry.id));
      // The checkpoint's references must agree with the durable selected branch.
      const records =
        await runtime.services.conversationLifecycle.getConversationEntries(
          conversation.id,
        );
      const byId = new Map(records.map((entry) => [entry.id, entry]));
      const branch = new Set<string>();
      let tip: string | undefined = checkpoint.harnessLeafId ?? undefined;
      while (tip) {
        branch.add(tip);
        tip = byId.get(tip)?.parentEntryId;
      }
      assert.ok(checkpoint.entryIds.every((id) => branch.has(id)));
      await assert.rejects(access(output));
      if (scenario.restart) {
        await shutdownServerRuntime(runtime.runtime);
        runtime = createRuntimeFixture(
          await initializeStorage(home),
          "127.0.0.1",
          0,
        );
        await runtime.lifecycle.hydrate();
        // Conversation journals are lazy-loaded when the conversation is opened.
        await runtime.services.conversationJournal.load(conversation.id);
        assert.ok(
          runtime.services.tools
            .listApprovals("pending")
            .some((item) => item.toolCallId === approval.toolCallId),
        );
      }
      let claims = 0;
      const claim = runtime.services.tools.claimApprovedExecution.bind(
        runtime.services.tools,
      );
      runtime.services.tools.claimApprovedExecution = ((id, assertContext) => {
        if (id === approval.toolCallId) claims += 1;
        return claim(id, assertContext);
      }) as typeof runtime.services.tools.claimApprovedExecution;
      if (scenario.stale) {
        await runtime.services.conversationLifecycle.appendEntry({
          conversationId: conversation.id,
          agentId: agent.id,
          role: "user",
          text: "Change branch before approving.",
        });
        await assert.rejects(
          runtime.services.humanInput.resolveApproval({
            toolCallId: approval.toolCallId,
            ordinal: 0,
            decision: "allow",
            resolutionRequestId: "stale_retry_approval",
          }),
          { code: "RUN_CHECKPOINT_STALE" },
        );
        assert.equal(claims, 0);
        await assert.rejects(access(output));
      } else {
        const decision = {
          toolCallId: approval.toolCallId,
          ordinal: 0,
          decision: "allow" as const,
          resolutionRequestId: "retry_approval",
        };
        await runtime.services.humanInput.resolveApproval(decision);
        await waitFor(
          async () =>
            (await unitOfWork.load(state.run.runId))?.run.status ===
            "completed",
        );
        assert.equal(await readFile(output, "utf8"), "approved once");
        assert.equal(claims, 1);
        await runtime.services.humanInput.resolveApproval(decision);
        assert.equal(claims, 1);
        const completed = (await unitOfWork.load(state.run.runId))!;
        assert.equal(
          completed.transitions
            .flatMap((transition) => transition.entries)
            .filter(
              (entry) =>
                (entry.details as { stopReason?: string } | undefined)
                  ?.stopReason === "error",
            ).length,
          scenario.failures,
        );
      }
    } finally {
      registration.unregister();
      await shutdownServerRuntime(runtime.runtime);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    }
  });
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for retry approval lifecycle");
}
