import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

async function eventually<T>(
  read: () => T | Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out awaiting child lifecycle boundary");
}

for (const kind of ["approval", "question"] as const)
  test(`child ${kind} survives queued configuration/input and restart; original tool settles before latest-config invocation`, async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-402-child-boundary-"));
    const home = join(root, "home"),
      workspace = join(root, "workspace");
    await mkdir(workspace);
    await mkdir(join(workspace, "next"));
    const marker = join(workspace, "original-scope.txt");
    const oldProvider = "nerve-scripted-402-old",
      nextProvider = "nerve-scripted-402-next";
    const old = registerAgentScriptedProvider({
      provider: oldProvider,
      steps: [
        {
          type: "toolCall",
          id: "child_original_write",
          name: kind === "approval" ? "write" : "ask_user",
          args:
            kind === "approval"
              ? { path: marker, content: "original tool completed" }
              : { question: "Which option?" },
        },
        { type: "assistantText", text: "obsolete old provider" },
      ],
    });
    const next = registerAgentScriptedProvider({
      provider: nextProvider,
      steps: [{ type: "assistantText", text: "latest child invocation" }],
    });
    next.setResponses([
      async (context) => {
        if (kind === "approval")
          assert.equal(
            await readFile(marker, "utf8"),
            "original tool completed",
            "associated original tool must settle before the next request",
          );
        else
          assert.ok(
            runtime.services.tools
              .listUserQuestions("answered")
              .some((question) => question.toolCallId),
          );
        assert.match(
          JSON.stringify(context.messages),
          /new child instructions/,
        );
        assert.equal(
          context.messages.find((message) => message.role === "system")
            ?.toolsAdded?.length ?? 0,
          0,
        );
        assert.ok(
          JSON.stringify(context.messages).includes("queued child steering"),
        );
        return fauxAssistantMessage("latest child invocation");
      },
    ]);
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
      const parent = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });
      const child = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent.id,
        name: "child",
        model: { provider: oldProvider, modelId: "scripted-fast" },
        tools: [kind === "approval" ? "write" : "ask_user"],
        permissionLevel: "supervised",
        permissionRuleSetId: "supervised",
      });
      await runtime.services.workbenchRun.promptAgent(child.id, {
        text: "Write in the original workspace.",
      });
      const pending = () =>
        kind === "approval"
          ? runtime.services.tools.listApprovals("pending")
          : runtime.services.tools.listUserQuestions("pending");
      const approval = await eventually(() =>
        pending().find((item) => item.agentId === child.id),
      );
      const originalTool = runtime.services.tools.getToolCall(
        approval.toolCallId,
      );
      const originalAuthority = structuredClone(originalTool.authoritySnapshot);
      assert.ok(
        originalAuthority,
        "suspended tool must retain original turn authority",
      );
      assert.equal(originalTool.cwd, workspace);
      assert.equal(
        originalAuthority.configuration.permissionLevel,
        "supervised",
      );
      await runtime.services.agentLifecycle.configureAgent(child.id, {
        model: { provider: nextProvider, modelId: "scripted-fast" },
        projectDir: join(workspace, "next"),
        tools: [],
        skills: null,
        instructions: "new child instructions",
        permissionLevel: "read_only",
        permissionRuleSetId: "read_only",
      });
      await runtime.services.workbenchRun.promptAgent(child.id, {
        text: "queued child steering",
        idempotencyKey: "child-steering",
      });
      assert.equal(
        pending().filter((item) => item.toolCallId === approval.toolCallId)
          .length,
        1,
      );
      await assert.rejects(readFile(marker));
      // Simulate daemon interruption, not an intentional attached-team stop.
      runtime.services.asyncSubagents.settleTeam = async () => undefined;
      await shutdownServerRuntime(runtime.runtime);
      runtime = createRuntimeFixture(
        await initializeStorage(home),
        "127.0.0.1",
        0,
      );
      await runtime.lifecycle.hydrate();
      assert.ok(
        pending().some((item) => item.toolCallId === approval.toolCallId),
      );
      await assert.rejects(readFile(marker));
      if (kind === "approval")
        await runtime.services.humanInput.resolveApproval({
          toolCallId: approval.toolCallId,
          ordinal: 0,
          decision: "allow",
          resolutionRequestId: "allow-original-child",
        });
      else
        await runtime.services.humanInput.answerUserQuestion(
          approval.id,
          "answer",
          "answer-original-child",
        );

      await eventually(async () => {
        const history = await runtime.services.workbenchRun.getAgentHistory(
          child.id,
        );
        return history.some((entry) =>
          entry.text?.includes("latest child invocation"),
        )
          ? history
          : undefined;
      }).catch(async (error) => {
        const tool = runtime.services.tools.getToolCall(approval.toolCallId);
        const run = tool.runId
          ? await runtime.services.workbenchRun.loadRunState(tool.runId)
          : undefined;
        throw new Error(
          `${error}; ${JSON.stringify({
            toolStatus: tool.status,
            runStatus: run?.run.status,
            acceptedConfiguration: runtime.services.agentLifecycle.getAgent(
              child.id,
            ).configurationRevision,
            effectiveConfiguration: runtime.services.agentLifecycle.getAgent(
              child.id,
            ).effectiveConfigurationRevision,
            history: await runtime.services.workbenchRun.getAgentHistory(
              child.id,
            ),
          })}`,
        );
      });
      const settledTool = runtime.services.tools.getToolCall(
        approval.toolCallId,
      );
      assert.equal(settledTool.status, "completed");
      assert.equal(settledTool.cwd, workspace);
      assert.deepEqual(settledTool.authoritySnapshot, originalAuthority);
      const configured = runtime.services.agentLifecycle.getAgent(child.id);
      assert.equal(configured.configurationRevision, 2);
      assert.equal(configured.effectiveConfigurationRevision, 2);
      assert.equal(configured.permissionLevel, "read_only");
      if (kind === "approval")
        assert.equal(await readFile(marker, "utf8"), "original tool completed");
      const parentHistory = await runtime.services.workbenchRun.getAgentHistory(
        parent.id,
      );
      assert.ok(
        !parentHistory.some(
          (entry) =>
            entry.text?.includes("queued child steering") ||
            entry.text?.includes("latest child invocation"),
        ),
      );
    } finally {
      await shutdownServerRuntime(runtime.runtime);
      old.unregister();
      next.unregister();
      await rm(root, { recursive: true, force: true });
    }
  });
