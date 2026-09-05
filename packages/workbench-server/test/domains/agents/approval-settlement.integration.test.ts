import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

for (const mode of ["single", "mixed", "policy"] as const)
  test(
    `approval receipt returns before execution and resumes a ${mode} checkpoint`,
    { timeout: 20_000 },
    async () => {
      const mixed = mode === "mixed";
      const provider = `nerve-scripted-approval-settlement-${mode}`;
      const registration = registerAgentScriptedProvider({
        provider,
        steps: [
          {
            type: "toolCalls",
            calls: [
              { id: "approved_pwd", name: "bash", args: { command: "pwd" } },
              ...(mixed
                ? [
                    {
                      id: "ask_confirmation",
                      name: "ask_user",
                      args: { question: "Confirm this check?" },
                    },
                  ]
                : []),
              ...(mode === "policy"
                ? [{ id: "policy_ls", name: "ls", args: { path: "." } }]
                : []),
            ],
          },
          { type: "assistantText", text: "Resumed after durable approval." },
        ],
      });
      const home = await mkdtemp(join(tmpdir(), "nerve-approval-integration-"));
      const storage = await initializeStorage(home);
      const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
      try {
        await runtime.lifecycle.hydrate();
        const project = await runtime.services.projectLifecycle.createProject({
          dir: home,
        });
        const conversation =
          await runtime.services.conversationLifecycle.createConversation({
            projectId: project.id,
            mode: "planning",
          });
        const agent = await runtime.services.agentLifecycle.createAgent({
          projectId: project.id,
          conversationId: conversation.id,
          mode: "planning",
          model: { provider, modelId: "scripted-fast" },
        });
        let waiting!: () => void;
        let completed!: () => void;
        const waited = new Promise<void>((resolve) => {
          waiting = resolve;
        });
        const finished = new Promise<void>((resolve) => {
          completed = resolve;
        });
        const unsubscribe = runtime.services.conversationJournal.onCommit(
          (commit) => {
            for (const event of commit.events) {
              if (
                event.kind !== "run.transition_committed" ||
                event.transition.run.agentId !== agent.id
              )
                continue;
              if (event.transition.run.status === "waiting") waiting();
              if (event.transition.run.status === "completed") completed();
            }
          },
        );
        try {
          await runtime.services.workbenchRun.promptAgent(agent.id, {
            prompt: "Check the working directory.",
          });
          await waited;
          const approval = runtime.services.tools
            .listApprovals("pending")
            .find((item) => item.agentId === agent.id)!;
          assert.ok(approval);
          const receipt = await runtime.services.humanInput.resolveApproval(
            approval.id,
            "allow",
            undefined,
            "approval-integration-request",
            "single_call",
          );
          assert.equal(receipt.status, "committed");
          assert.equal(receipt.attempt, 0);
          if (mixed) {
            const question = runtime.services.tools
              .listUserQuestions("pending")
              .find((item) => item.agentId === agent.id)!;
            assert.ok(question);
            await runtime.services.humanInput.answerUserQuestion(
              question.id,
              "Yes",
              "mixed-question-answer",
            );
          }
          await finished;
          const tool = await runtime.services.tools.getToolCallDetails(
            receipt.id,
          );
          assert.equal(tool.status, "completed");
          assert.equal(tool.attempt, 1);
          const state = await runtime.services.conversationJournal.load(
            conversation.id,
          );
          const settlement = [...state.approvalSettlements.values()][0]!;
          assert.equal(settlement.phase, "completed");
          assert.equal(
            state.entries.filter(
              (entry) =>
                (entry.details as { toolRecordId?: string } | undefined)
                  ?.toolRecordId === tool.id,
            ).length,
            1,
          );
          assert.ok(
            state.entries.some((entry) =>
              entry.text.includes("Resumed after durable approval"),
            ),
          );
        } finally {
          unsubscribe();
        }
      } finally {
        registration.unregister();
        await shutdownServerRuntime(runtime.runtime);
        await rm(home, { recursive: true, force: true });
      }
    },
  );
