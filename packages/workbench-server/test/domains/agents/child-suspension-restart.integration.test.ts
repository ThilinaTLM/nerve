import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
  getCurrentSystemPrompt,
  type TranscriptContext,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { effectiveTurnConfigurationSchema } from "@nervekit/contracts/agents";
import {
  registerManagedFauxProvider,
  registerManagedProvider,
} from "@nervekit/harness/models";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

async function eventually<T>(
  label: string,
  read: () => Promise<T | undefined> | T | undefined,
  diagnostics: () => unknown,
): Promise<T> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label}: ${JSON.stringify(diagnostics())}`);
}

async function skill(cwd: string, name: string) {
  const dir = join(cwd, ".nerve", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} integration resource\n---\n\n${name} body.\n`,
  );
}

// Runtime's existing single-approval test does not cover the remaining original
// question in the same provider tool batch, or ordered notification delivery.
for (const nativeLast of [false, true])
  test(
    `child original approval/question batch survives restart and defers coherent new config and ordered inputs until both settle (${nativeLast ? "approval-first native-last" : "question-first approval-last"})`,
    { timeout: 45_000 },
    async () => {
      const root = await mkdtemp(
        join(tmpdir(), "nerve-child-suspension-restart-"),
      );
      const home = join(root, "home");
      const workspace = join(root, "workspace");
      const nextCwd = join(workspace, "next");
      await mkdir(nextCwd, { recursive: true });
      await skill(workspace, "old-skill");
      await skill(nextCwd, "next-skill");
      const marker = join(workspace, "original-authority.txt");
      const oldProvider = registerManagedFauxProvider({
        provider: `nerve-402-suspend-old-${process.pid}-${nativeLast}`,
        models: [{ id: "old-model", reasoning: true }],
        tokensPerSecond: 100_000,
      });
      const nextProvider = registerManagedFauxProvider({
        provider: `nerve-402-suspend-next-${process.pid}-${nativeLast}`,
        models: [{ id: "next-model", reasoning: true }],
        tokensPerSecond: 100_000,
      });
      // Official registry API makes these supported model selections rather than
      // the intentional unknown-provider fallback to nerve-faux.
      registerManagedProvider(oldProvider.provider);
      registerManagedProvider(nextProvider.provider);
      oldProvider.setResponses([
        fauxAssistantMessage([
          fauxToolCall(
            "write",
            { path: marker, content: "original batch write" },
            { id: "original_write" },
          ),
          fauxToolCall(
            "ask_user",
            { question: "Original batch question: choose a value." },
            { id: "original_question" },
          ),
        ]),
      ]);
      const requests: {
        context: TranscriptContext;
        options: SimpleStreamOptions | undefined;
        modelId: string;
      }[] = [];
      nextProvider.setResponses([
        (context, options, _state, model) => {
          requests.push({
            // Tool schemas may carry callable validators; capture the actual
            // provider-safe JSON projection, not functions via structuredClone.
            context: JSON.parse(JSON.stringify(context)) as TranscriptContext,
            options: options ? { reasoning: options.reasoning } : undefined,
            modelId: model.id,
          });
          return fauxAssistantMessage(
            "Coherent next child provider completed.",
          );
        },
      ]);
      let debugAgentId: string | undefined;
      const evidence: unknown[] = [];
      let runtime = createRuntimeFixture(
        await initializeStorage(home),
        "127.0.0.1",
        39871,
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
          name: "suspension-child",
          model: { provider: oldProvider.provider.id, modelId: "old-model" },
          thinkingLevel: "low",
          tools: ["write", "ask_user"],
          skills: ["old-skill"],
          systemPrompt: "ORIGINAL_CUSTOM_PROMPT",
          instructions: "ORIGINAL_INSTRUCTIONS",
          permissionLevel: "supervised",
          permissionRuleSetId: "supervised",
        });
        debugAgentId = child.id;
        const diagnostics = () => ({
          oldCalls: oldProvider.state.callCount,
          nextCalls: nextProvider.state.callCount,
          child: runtime.services.agentLifecycle.getAgent(child.id),
          tools: runtime.services.tools.listToolCalls(),
          questions: runtime.services.tools.listUserQuestions(),
        });
        await runtime.services.workbenchRun.promptAgent(child.id, {
          text: "Run the original write and then ask the original question.",
        });
        const approval = await eventually(
          "child approval",
          () =>
            runtime.services.tools
              .listApprovals("pending")
              .find((item) => item.agentId === child.id),
          diagnostics,
        );
        const originalTool = await runtime.services.tools.getToolCallDetails(
          approval.toolCallId,
        );
        const originalAuthority = structuredClone(
          originalTool.authoritySnapshot,
        );
        assert.ok(
          originalAuthority?.configuration,
          "provider batch must persist full original ordinary configuration",
        );
        assert.equal(
          originalAuthority.configurationProvenance,
          "resolved",
          "provider tools must capture fully resolved authority before invocation",
        );
        assert.equal(
          originalAuthority.configuration.model?.modelId,
          "old-model",
        );
        assert.equal(originalAuthority.configuration.thinkingLevel, "low");
        assert.deepEqual(originalAuthority.configuration.skills, ["old-skill"]);
        assert.match(
          originalAuthority.configuration.systemPrompt ?? "",
          /ORIGINAL_CUSTOM_PROMPT/,
        );
        assert.match(
          originalAuthority.configuration.systemPrompt ?? "",
          /ORIGINAL_INSTRUCTIONS/,
        );
        assert.ok(originalTool.runId);
        const originalRunId = originalTool.runId;
        const configured = await runtime.services.agentLifecycle.configureAgent(
          child.id,
          {
            model: {
              provider: nextProvider.provider.id,
              modelId: "next-model",
            },
            thinkingLevel: "high",
            tools: ["read"],
            skills: ["next-skill"],
            systemPrompt: "NEXT_CUSTOM_PROMPT",
            instructions: "NEXT_INSTRUCTIONS",
            mode: "planning",
            projectDir: nextCwd,
            workspaceScope: { roots: [nextCwd], readonly: true },
            permissionLevel: "read_only",
            permissionRuleSetId: "read_only",
          },
        );
        const user = await runtime.services.workbenchRun.enqueueAgentInput(
          child.id,
          {
            role: "user",
            origin: { kind: "user", userId: "integration-user" },
            text: "ORDERED_USER_AFTER_SUSPENSION",
            idempotencyKey: "restart-ordered-user",
            eligibility: { kind: "next_turn" },
            activation: "wake_if_idle",
          },
        );
        const notification =
          await runtime.services.workbenchRun.enqueueAgentInput(child.id, {
            role: "system",
            origin: {
              kind: "system",
              producer: "integration-verifier",
              correlationId: "restart-notification",
            },
            text: "ORDERED_TRUSTED_NOTIFICATION",
            idempotencyKey: "restart-ordered-notification",
            eligibility: { kind: "next_turn" },
            activation: "wake_if_idle",
          });
        assert.ok(user.sequence < notification.sequence);
        async function assertSuspendedWithoutDelivery() {
          await new Promise((resolve) => setTimeout(resolve, 100));
          assert.equal(
            nextProvider.state.callCount,
            0,
            "configuration/input must not dispatch through unresolved original interaction",
          );
          assert.equal(oldProvider.state.callCount, 1);
          const entries = await (
            await runtime.services.harnessStorage.openAgentStorage(
              runtime.services.agentLifecycle.getAgent(child.id),
            )
          ).getEntries();
          assert.equal(
            entries.filter(
              (entry) =>
                entry.id === `entry_${user.id}` ||
                entry.id === `entry_${notification.id}`,
            ).length,
            0,
            "pending input must not be inserted early",
          );
          const pending = await runtime.services.workbenchRun.listQueuedPrompts(
            child.id,
          );
          assert.ok(pending.some((input) => input.id === user.id));
          assert.ok(pending.some((input) => input.id === notification.id));
        }
        await assertSuspendedWithoutDelivery();
        await assert.rejects(readFile(marker));
        // Graceful shutdown intentionally settles/cancels children. A consistent
        // online SQLite backup captures a crash checkpoint BEFORE that cleanup.
        const recoveredHome = join(root, "recovered-home");
        await cp(home, recoveredHome, { recursive: true });
        const recoveredSqlite = join(recoveredHome, "data", "nerve.sqlite");
        for (const suffix of ["", "-wal", "-shm"])
          await rm(`${recoveredSqlite}${suffix}`, { force: true });
        await rm(join(recoveredHome, "cache"), {
          recursive: true,
          force: true,
        });
        const sourceDatabase = new DatabaseSync(
          join(home, "data", "nerve.sqlite"),
          { readOnly: true },
        );
        try {
          await backup(sourceDatabase, recoveredSqlite);
        } finally {
          sourceDatabase.close();
        }
        await shutdownServerRuntime(runtime.runtime);
        runtime = createRuntimeFixture(
          await initializeStorage(recoveredHome),
          "127.0.0.1",
          39872,
        );
        await runtime.lifecycle.hydrate();
        await assertSuspendedWithoutDelivery();
        assert.deepEqual(
          (await runtime.services.tools.getToolCallDetails(approval.toolCallId))
            .authoritySnapshot,
          originalAuthority,
        );
        const recoveredRun =
          await runtime.services.workbenchRun.loadRunState(originalRunId);
        assert.equal(recoveredRun?.run.status, "waiting");
        assert.ok(
          recoveredRun?.interactions.some(
            (interaction) =>
              interaction.kind === "approval" &&
              interaction.status === "pending",
          ),
        );
        assert.ok(
          recoveredRun?.interactions.some(
            (interaction) =>
              interaction.kind === "user_input" &&
              interaction.status === "pending",
          ),
        );
        const recoveredQuestion = runtime.services.tools
          .listUserQuestions("pending")
          .find((item) => item.agentId === child.id);
        assert.ok(
          recoveredQuestion,
          "same original common-engine batch must preserve its pending child question",
        );
        const recoveredQuestionTool =
          await runtime.services.tools.getToolCallDetails(
            recoveredQuestion.toolCallId,
          );
        assert.equal(recoveredQuestionTool.runId, originalRunId);
        assert.equal(
          recoveredQuestionTool.authoritySnapshot?.configurationProvenance,
          "resolved",
          "provider-generated question must share the original fully resolved actor, not raw accepted defaults",
        );
        assert.deepEqual(
          recoveredQuestionTool.authoritySnapshot?.configuration,
          originalAuthority.configuration,
        );
        const approve = () =>
          runtime.services.humanInput.resolveApproval({
            toolCallId: approval.toolCallId,
            ordinal: 0,
            decision: "allow",
            resolutionRequestId: "restart-allow-original",
          });
        const answer = () =>
          runtime.services.humanInput.answerUserQuestion(
            recoveredQuestion.id,
            "original answer",
            "restart-answer-original",
          );
        if (nativeLast) await approve();
        else await answer();
        await assertSuspendedWithoutDelivery();
        await assert.rejects(readFile(marker));
        if (!nativeLast)
          assert.ok(
            runtime.services.tools
              .listApprovals("pending")
              .some((item) => item.toolCallId === approval.toolCallId),
          );
        if (nativeLast) await answer();
        else await approve();
        await eventually(
          "next configured child provider",
          () => requests[0],
          diagnostics,
        );
        const queueAtResponse =
          await runtime.runtime.storage.canonicalStore.readDocument(
            "agent_inputs",
            "global",
            child.id,
          );
        evidence.push({
          stage: "next-provider-observed",
          queue: queueAtResponse,
          runs: await runtime.runtime.storage.canonicalStore.listRunMetadata(),
        });
        let completionDiagnostics: unknown;
        await eventually(
          "child completion",
          async () => {
            const activity =
              await runtime.services.agentActivity.activityForAgent(child.id);
            const runs = (
              await runtime.runtime.storage.canonicalStore.listRunMetadata()
            ).filter((run) => run.agentId === child.id);
            completionDiagnostics = { activity, runs };
            return activity.state === "idle" ? true : undefined;
          },
          () => ({ ...diagnostics(), completionDiagnostics }),
        );
        assert.equal(await readFile(marker, "utf8"), "original batch write");
        assert.equal(nextProvider.state.callCount, 1);
        assert.equal(oldProvider.state.callCount, 1);
        assert.equal(requests[0]!.modelId, "next-model");
        assert.equal(requests[0]!.options?.reasoning, "high");
        assert.deepEqual(
          getCurrentTools(requests[0]!.context.messages).map(
            (tool) => tool.name,
          ),
          ["read"],
        );
        assert.match(
          getCurrentSystemPrompt(requests[0]!.context.messages),
          /NEXT_CUSTOM_PROMPT/,
        );
        assert.match(
          getCurrentSystemPrompt(requests[0]!.context.messages),
          /NEXT_INSTRUCTIONS/,
        );
        const serialized = JSON.stringify(requests[0]!.context.messages);
        assert.equal(
          serialized.split("ORDERED_USER_AFTER_SUSPENSION").length - 1,
          1,
        );
        assert.equal(
          serialized.split("ORDERED_TRUSTED_NOTIFICATION").length - 1,
          1,
        );
        assert.ok(
          serialized.indexOf("ORDERED_USER_AFTER_SUSPENSION") <
            serialized.indexOf("ORDERED_TRUSTED_NOTIFICATION"),
        );
        const childRuns = (
          await runtime.runtime.storage.canonicalStore.listRunMetadata()
        ).filter((run) => run.agentId === child.id);
        const childStates = await Promise.all(
          childRuns.map((run) =>
            runtime.services.workbenchRun.loadRunState(run.runId),
          ),
        );
        // Runtime's owning immutable writer is the attempt-fenced run transition,
        // not a separate effective-turn document projection.
        const turns = childStates.flatMap(
          (state) =>
            state?.transitions.flatMap(
              (transition) =>
                transition.execution?.effectiveTurnConfigurations ?? [],
            ) ?? [],
        );
        const effectiveDetails = turns
          .map((configuration) =>
            effectiveTurnConfigurationSchema.parse(configuration),
          )
          .find(
            (turn) =>
              turn.configurationRevision === configured.configurationRevision,
          );
        assert.ok(
          effectiveDetails,
          "provider boundary must durably record the configured effective turn",
        );
        assert.equal(effectiveDetails.configurationProvenance, "resolved");
        assert.equal(
          effectiveDetails.configurationRevision,
          configured.configurationRevision,
        );
        assert.equal(effectiveDetails.configuration?.projectDir, nextCwd);
        assert.equal(effectiveDetails.configuration?.mode, "planning");
        assert.equal(
          effectiveDetails.configuration?.permissionLevel,
          "read_only",
        );
        assert.deepEqual(effectiveDetails.configuration?.skills, [
          "next-skill",
        ]);
        const entries = await (
          await runtime.services.harnessStorage.openAgentStorage(
            runtime.services.agentLifecycle.getAgent(child.id),
          )
        ).getEntries();
        for (const input of [user, notification])
          assert.equal(
            entries.filter((entry) => entry.id === `entry_${input.id}`).length,
            1,
          );
        assert.equal(
          (await runtime.services.workbenchRun.listQueuedPrompts(child.id))
            .length,
          0,
        );
        const questionRecovery = await eventually(
          "durable question reconciliation settles successfully",
          async () => {
            const work = (
              await Promise.all(
                childRuns.map((run) =>
                  runtime.runtime.storage.canonicalStore.listLifecycleWorkForRun(
                    run.runId,
                  ),
                ),
              )
            )
              .flat()
              .filter(
                (item) =>
                  item.kind === "reconcile_conversation" &&
                  item.proposalId === recoveredQuestion.toolCallId,
              );
            return work.length &&
              work.every((item) =>
                [
                  "succeeded",
                  "failed",
                  "cancelled",
                  "outcome_unknown",
                ].includes(item.state),
              )
              ? work
              : undefined;
          },
          diagnostics,
        );
        assert.ok(
          questionRecovery.every((item) => item.state === "succeeded"),
          "immediate answer and durable recovery must not race into terminal tool revisions",
        );
        const parentHistory = JSON.stringify(
          await runtime.services.workbenchRun.getAgentHistory(parent.id),
        );
        assert.doesNotMatch(
          parentHistory,
          /ORDERED_USER_AFTER_SUSPENSION|ORDERED_TRUSTED_NOTIFICATION|Coherent next child provider/,
        );
      } finally {
        if (debugAgentId) {
          const runs = (
            await runtime.runtime.storage.canonicalStore.listRunMetadata()
          ).filter((run) => run.agentId === debugAgentId);
          const states = await Promise.all(
            runs.map((run) =>
              runtime.services.workbenchRun.loadRunState(run.runId),
            ),
          );
          const tools = await Promise.all(
            [
              ...new Set(
                states.flatMap(
                  (state) =>
                    state?.interactions.map(
                      (interaction) => interaction.toolCallId,
                    ) ?? [],
                ),
              ),
            ].map((id) => runtime.services.tools.getToolCallDetails(id)),
          );
          const work = await Promise.all(
            runs.map((run) =>
              runtime.runtime.storage.canonicalStore.listLifecycleWorkForRun(
                run.runId,
              ),
            ),
          );
          const queue =
            await runtime.runtime.storage.canonicalStore.readDocument(
              "agent_inputs",
              "global",
              debugAgentId,
            );
          const entries = await (
            await runtime.services.harnessStorage.openAgentStorage(
              runtime.services.agentLifecycle.getAgent(debugAgentId),
            )
          ).getEntries();
          const artifact = `/tmp/402-child-debug-${process.pid}-${nativeLast ? "native-last" : "approval-last"}.json`;
          await writeFile(
            artifact,
            JSON.stringify(
              {
                capturedAt: new Date().toISOString(),
                home: runtime.runtime.storage.paths.home,
                agentId: debugAgentId,
                evidence,
                queue,
                states,
                tools,
                work,
                entries,
              },
              null,
              2,
            ),
          );
          console.log(`Child evidence: ${artifact}`);
        }
        await shutdownServerRuntime(runtime.runtime).catch(() => undefined);
        oldProvider.unregister();
        nextProvider.unregister();
        await rm(root, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  );

test(
  "a real Explore readonly ceiling survives user configuration and a provider requesting an unavailable write",
  { timeout: 25_000 },
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "nerve-explore-immutable-floor-"),
    );
    const home = join(root, "home");
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const marker = join(workspace, "must-not-exist.txt");
    const provider = registerManagedFauxProvider({
      provider: `nerve-402-floor-${process.pid}`,
      models: [{ id: "floor-model" }],
      tokensPerSecond: 100_000,
    });
    registerManagedProvider(provider.provider);
    provider.setResponses([
      fauxAssistantMessage([
        fauxToolCall(
          "write",
          { path: marker, content: "forbidden" },
          { id: "floor_write" },
        ),
      ]),
      fauxAssistantMessage("Readonly child remained readonly."),
    ]);
    const runtime = createRuntimeFixture(
      await initializeStorage(home),
      "127.0.0.1",
      39873,
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
        permissionLevel: "autonomous",
      });
      const child = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent.id,
        permissionLevel: "read_only",
        readOnlyCeiling: true,
        workspaceScope: { roots: [workspace], readonly: true },
        orchestrationPolicy: {
          preset: "explore",
          parentCancellation: "attached",
          completionReporting: "parent",
        },
        model: { provider: provider.provider.id, modelId: "floor-model" },
        skills: [],
        tools: ["read"],
      });
      assert.equal(child.readOnlyCeiling, true);
      await assert.rejects(
        runtime.services.agentLifecycle.configureAgent(child.id, {
          permissionLevel: "autonomous",
          permissionRuleSetId: "autonomous",
        }),
        /read.only|ceiling/i,
      );
      await assert.rejects(
        runtime.services.agentLifecycle.configureAgent(child.id, {
          workspaceScope: { roots: [workspace], readonly: false },
        }),
        /read.only|ceiling/i,
      );
      const configured = await runtime.services.agentLifecycle.configureAgent(
        child.id,
        {
          instructions:
            "User-configured instructions cannot revoke immutable readonly.",
          tools: ["read"],
        },
      );
      assert.equal(configured.readOnlyCeiling, true);
      assert.equal(configured.workspaceScope.readonly, true);
      await runtime.services.workbenchRun.promptAgent(child.id, {
        text: "Attempt the scripted write and report the denial.",
      });
      const diagnostics = () => ({
        child: runtime.services.agentLifecycle.getAgent(child.id),
        tools: runtime.services.tools.listToolCalls(),
        calls: provider.state.callCount,
      });
      // An unavailable tool is rejected by the actual harness before host
      // dispatch, so its owning evidence is the harness tool-result entry,
      // not a fabricated host ToolCallRecord.
      const rejected = await eventually(
        "readonly child provider write rejection",
        async () => {
          const entries = await (
            await runtime.services.harnessStorage.openAgentStorage(
              runtime.services.agentLifecycle.getAgent(child.id),
            )
          ).getEntries();
          return entries.find(
            (entry) =>
              entry.type === "message" &&
              entry.message.role === "toolResult" &&
              entry.message.toolName === "write",
          );
        },
        diagnostics,
      );
      assert.ok(rejected.type === "message");
      assert.ok(rejected.message.role === "toolResult");
      assert.equal(rejected.message.isError, true);
      assert.match(
        JSON.stringify(rejected),
        /not available|not found|unknown tool/i,
      );
      const settledRun = await eventually(
        "readonly child terminal run",
        async () =>
          (await runtime.runtime.storage.canonicalStore.listRunMetadata()).find(
            (run) =>
              run.agentId === child.id &&
              ["completed", "failed", "cancelled", "interrupted"].includes(
                run.status,
              ),
          ),
        diagnostics,
      );
      assert.notEqual(settledRun.status, "cancelled");
      assert.notEqual(settledRun.status, "interrupted");
      assert.equal(provider.state.callCount, 2);
      await assert.rejects(readFile(marker));
      assert.equal(
        runtime.services.agentLifecycle.getAgent(child.id).readOnlyCeiling,
        true,
      );
    } finally {
      await shutdownServerRuntime(runtime.runtime).catch(() => undefined);
      provider.unregister();
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    }
  },
);
