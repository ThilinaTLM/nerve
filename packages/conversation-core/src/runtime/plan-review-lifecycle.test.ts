import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { ConversationCore } from "../core.js";
import {
  waitUntil,
  options,
  createConversation,
} from "./lifecycle-test-helpers.js";

for (const scenario of [
  {
    decision: "reject",
    feedback: undefined,
    recoverPending: false,
    sibling: false,
  },
  {
    decision: "reject",
    feedback: "Use a smaller scope.",
    recoverPending: true,
    sibling: false,
  },
  {
    decision: "reject",
    feedback: undefined,
    recoverPending: true,
    sibling: true,
  },
  {
    decision: "approve",
    feedback: "Keep the reviewed scope.",
    recoverPending: false,
    sibling: false,
  },
  {
    decision: "approve",
    feedback: "Keep the reviewed scope.",
    recoverPending: false,
    sibling: true,
  },
] as const) {
  void test(
    `plan ${scenario.decision} ${scenario.recoverPending ? "after recovery" : "during execution"}${scenario.sibling ? " with a pending sibling" : ""} controls continuation`,
    { timeout: 5000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "nerve-plan-review-"));
      const database = join(directory, "core.sqlite");
      let modelTurns = 0;
      const provider = registerAgentScriptedProvider({
        provider: `plan-${randomUUID()}`,
        model: "test",
        steps: [
          {
            type: "toolCalls",
            calls: [
              {
                id: "present_plan",
                name: "plan_present",
                args: { file_path: "/plans/implementation.md" },
              },
              ...(scenario.sibling
                ? [
                    {
                      id: "sibling_question",
                      name: "ask_user",
                      args: { question: "Which option?" },
                    },
                  ]
                : []),
            ],
          },
          { type: "assistantText", text: "Follow-up response" },
        ],
      });
      let approvalProfile = "coding";
      let activeConfig!: ReturnType<typeof options>;
      const makeOptions = () => {
        const config = options(
          directory,
          database,
          {
            resolve: async () => {
              const model = provider.getModel("test");
              if (!model) throw new Error("Missing scripted model");
              return { model };
            },
          },
          {
            execute: async () => {
              throw new Error("No host tools expected");
            },
            isReplaySafe: () => false,
          },
        );
        const capture = config.configuration.captureRequest;
        config.configuration.captureRequest = async (input) => {
          if (modelTurns === 1 && scenario.decision === "approve") {
            assert.equal(
              config.storage.events
                .since("conv_plan", 0)
                .filter(
                  (event) =>
                    event.type === "user_message" &&
                    event.payload.text.startsWith(
                      "The user has accepted the plan. Please implement it.",
                    ),
                ).length,
              1,
              "implementation must be delivered before configuration capture",
            );
          }
          return capture(input);
        };
        config.turnResources.prepare = async (input) => {
          modelTurns++;
          if (modelTurns === 2 && scenario.decision === "approve") {
            const messages = activeConfig.storage.events
              .since("conv_plan", 0)
              .filter(
                (event) =>
                  event.type === "user_message" &&
                  event.payload.text.startsWith(
                    "The user has accepted the plan. Please implement it.",
                  ),
              );
            assert.equal(
              messages.length,
              1,
              "implementation is delivered before fresh capture/preparation",
            );
            assert.equal(
              input.config.agentProfile,
              "coding",
              "request uses a fresh implementation profile capture",
            );
            const message = messages[0];
            assert.ok(message?.type === "user_message");
            assert.match(
              message.payload.text,
              /^The user has accepted the plan\. Please implement it\.\n\nPlan file: .+\/plan\.md\n\nApproval feedback:\nKeep the reviewed scope\.$/,
            );
            assert.doesNotMatch(
              message.payload.text,
              /# Implementation plan|A reviewed snapshot/,
            );
          }
          return { systemPrompt: "Test", tools: [] };
        };
        config.planApprovalProfile = async () => approvalProfile;
        const defaults = config.defaultConfig;
        config.defaultConfig = async (projectId) => ({
          ...(await defaults(projectId)),
          agentProfile: "planning",
        });
        config.readPlan = async () =>
          "# Implementation plan\n\nA reviewed snapshot.";
        config.configuration.update("conv_plan", { agentProfile: "planning" });
        activeConfig = config;
        return config;
      };
      let core = new ConversationCore(makeOptions());
      try {
        await core.start();
        await createConversation(core, "conv_plan");
        assert.equal(
          activeConfig.configuration.snapshot("conv_plan").agentProfile,
          "planning",
        );
        core.submitInput({
          conversationId: "conv_plan",
          inputId: "input_plan",
          text: "Present a plan",
          source: "user",
        });
        await waitUntil(() =>
          core
            .getSnapshot("conv_plan")
            .toolCalls.some((call) => call.interaction?.kind === "plan_review"),
        );
        const call = core
          .getSnapshot("conv_plan")
          .toolCalls.find((call) => call.interaction?.kind === "plan_review")!;
        if (scenario.recoverPending) {
          await core.close();
          core = new ConversationCore(makeOptions());
          await core.start();
        }
        if (scenario.decision === "reject")
          core.submitInput({
            conversationId: "conv_plan",
            inputId: "input_already_queued",
            text: "A request queued before the rejection",
            source: "user",
          });
        assert.equal(call.interaction?.kind, "plan_review");
        if (call.interaction?.kind === "plan_review")
          assert.equal(call.interaction.request.targetProfile.name, "coding");
        // Editing the tool configuration after presentation must not retarget this review.
        approvalProfile = "planning";
        const resolution = {
          toolCallId: call.id,
          resolutionRequestId: "resolution_plan",
          resolution:
            scenario.decision === "approve"
              ? {
                  kind: "plan_review" as const,
                  decision: "approve" as const,
                  confirmation: {
                    targetProfile:
                      call.interaction!.kind === "plan_review"
                        ? call.interaction!.request.targetProfile
                        : { name: "coding", digest: "0".repeat(64) },
                    expectedRevision: 0,
                    expectedDigest: "missing",
                    transitionId: "transition_plan",
                    choices: {
                      model: { provider: "user", modelId: "chosen-model" },
                      reasoningLevel: "high" as const,
                    },
                  },
                  feedback: scenario.feedback,
                }
              : {
                  kind: "plan_review" as const,
                  decision: "reject" as const,
                  feedback: scenario.feedback,
                },
        };
        // A concurrent identical request (UI retry or reconciliation) joins the
        // in-flight resolution instead of re-resolving a settled call.
        const [first, duplicate] = await Promise.all([
          core.resolveInteraction(resolution),
          core.resolveInteraction(resolution),
        ]);
        assert.deepEqual(duplicate, first);
        if (scenario.sibling) {
          assert.equal(
            core.getSnapshot("conv_plan").conversation.status,
            "waiting",
          );
          assert.equal(modelTurns, 1);
          const sibling = core
            .getSnapshot("conv_plan")
            .toolCalls.find((call) => call.interaction?.kind === "user_input")!;
          await core.resolveInteraction({
            toolCallId: sibling.id,
            resolutionRequestId: "resolution_sibling",
            resolution: { kind: "user_input", answers: { answer: "Blue" } },
          });
        }
        await waitUntil(
          () => core.getSnapshot("conv_plan").conversation.status === "idle",
        );
        // Repeated acknowledgements must not restart work or duplicate the result.
        activeConfig.configuration.profiles.preview = async () => {
          throw new Error("Settled approvals must not read current state");
        };
        activeConfig.configuration.profiles.apply = async () => {
          throw new Error("Settled approvals must not reapply");
        };
        await core.resolveInteraction(resolution);
        const responses = core
          .getEventsSince("conv_plan", 0)
          .filter(
            (event) =>
              event.type === "tool_call_response" &&
              event.payload.toolCallId === call.id,
          );
        assert.equal(responses.length, 1);
        const response = responses[0];
        assert.ok(response?.type === "tool_call_response");
        assert.equal(response.payload.outcome, "completed");
        assert.equal(
          response.payload.interactionResolution?.kind,
          "plan_review",
        );
        const storedResolution = response.payload.interactionResolution;
        assert.ok(storedResolution?.kind === "plan_review");
        assert.equal(storedResolution.decision, scenario.decision);
        assert.equal(storedResolution.feedback, scenario.feedback);
        assert.equal(
          activeConfig.configuration.snapshot("conv_plan").agentProfile,
          scenario.decision === "approve" ? "coding" : "planning",
        );
        if (scenario.decision === "approve") {
          assert.deepEqual(
            activeConfig.configuration.snapshot("conv_plan").model,
            {
              provider: "user",
              modelId: "chosen-model",
            },
          );
          assert.equal(
            activeConfig.configuration.snapshot("conv_plan").reasoningLevel,
            "high",
          );
          assert.equal(modelTurns, 2);
          assert.equal(
            core.getSnapshot("conv_plan").conversation.paused,
            false,
          );
          activeConfig.configuration.update("conv_plan", {
            agentProfile: "planning",
          });
          assert.equal(
            (await core.resolveInteraction(resolution)).status,
            "resolved",
          );
          assert.equal(
            activeConfig.configuration.snapshot("conv_plan").agentProfile,
            "planning",
          );
          assert.equal(
            core
              .getEventsSince("conv_plan", 0)
              .filter(
                (event) =>
                  event.type === "user_message" &&
                  event.payload.text.startsWith(
                    "The user has accepted the plan. Please implement it.",
                  ),
              ).length,
            1,
          );
          return;
        }
        assert.equal(modelTurns, 1);
        assert.equal(core.getSnapshot("conv_plan").conversation.paused, true);
        // System notifications cannot undo the rejection gate, including on restart.
        core.inputs.enqueueNotice({
          conversationId: "conv_plan",
          inputId: "input_notice",
          subtype: "sub_conversation_event",
          producer: "conv_child",
          text: "Background work finished",
          details: {
            childConversationId: "conv_child",
            assignmentId: "input_assignment",
            status: "completed",
            assetIds: [],
          },
          wakeWhenIdle: true,
        });
        await delay(20);
        assert.equal(modelTurns, 1);
        await core.close();
        core = new ConversationCore(makeOptions());
        await core.start();
        await delay(20);
        assert.equal(modelTurns, 1);
        assert.equal(core.getSnapshot("conv_plan").conversation.status, "idle");
        core.submitInput({
          conversationId: "conv_plan",
          inputId: "input_followup",
          text: "Revise the plan with a smaller scope",
          source: "user",
        });
        await waitUntil(
          () =>
            modelTurns === 2 &&
            core.getSnapshot("conv_plan").conversation.status === "idle",
        );
        assert.equal(core.getSnapshot("conv_plan").conversation.paused, false);
        assert.equal(
          activeConfig.configuration.snapshot("conv_plan").agentProfile,
          "planning",
        );
        assert.ok(
          core
            .getEventsSince("conv_plan", 0)
            .some(
              (event) =>
                event.type === "user_message" &&
                event.inputId === "input_followup",
            ),
        );
      } finally {
        await core.close();
        provider.unregister();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

for (const failure of [
  "stale",
  "persistence",
  "queue",
  "settlement",
  "unrelated-edit",
] as const) {
  void test(
    `plan ${failure} failure keeps review pending and releases resolution locks`,
    { timeout: 5000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "nerve-plan-retry-"));
      const provider = registerAgentScriptedProvider({
        provider: `plan-retry-${randomUUID()}`,
        model: "test",
        steps: [
          {
            type: "toolCalls",
            calls: [
              {
                id: "plan",
                name: "plan_present",
                args: { file_path: "/plan.md" },
              },
            ],
          },
          { type: "assistantText", text: "Implemented once" },
        ],
      });
      const makeOptions = () =>
        options(
          directory,
          join(directory, "core.sqlite"),
          { resolve: async () => ({ model: provider.getModel("test")! }) },
          {
            execute: async () => {
              throw new Error("Unexpected host tool");
            },
            isReplaySafe: () => false,
          },
        );
      let config = makeOptions();
      config.readPlan = async () => "# Plan";
      config.planApprovalProfile = async () => "coding";
      let apply = config.configuration.profiles.apply;
      const refresh = {
        status: "refresh_required" as const,
        reason: "configuration_changed" as const,
        diagnostics: [],
      };
      config.configuration.profiles.apply = async (input) => {
        if (failure === "persistence" || failure === "unrelated-edit")
          throw new Error("Injected persistence failure");
        if (failure === "queue" || failure === "settlement")
          return apply(input);
        return refresh;
      };
      let core = new ConversationCore(config);
      try {
        await core.start();
        await createConversation(core, "conv_retry");
        core.submitInput({
          conversationId: "conv_retry",
          inputId: "input_retry",
          text: "Present a plan",
          source: "user",
        });
        await waitUntil(() =>
          core
            .getSnapshot("conv_retry")
            .toolCalls.some((call) => call.interaction?.kind === "plan_review"),
        );
        const call = core
          .getSnapshot("conv_retry")
          .toolCalls.find((call) => call.interaction?.kind === "plan_review")!;
        if (call.interaction?.kind !== "plan_review")
          throw new Error("Missing review");
        let request = call.interaction.request;
        const approve = (id: string) => ({
          toolCallId: call.id,
          resolutionRequestId: id,
          resolution: {
            kind: "plan_review" as const,
            decision: "approve" as const,
            confirmation: {
              targetProfile: request.targetProfile,
              expectedRevision: request.expectedRevision,
              expectedDigest: request.expectedDigest,
              transitionId: id,
              choices: { reasoningLevel: "high" as const },
            },
          },
        });
        if (failure === "unrelated-edit") {
          // Target and choices were already active; an unrelated edit advances CAS.
          config.configuration.update("conv_retry", {
            agentProfile: "coding",
            reasoningLevel: "high",
            instructions: "Unrelated edit",
          });
          const preview = config.configuration.profiles.preview;
          config.configuration.profiles.preview = async (...args) => {
            const result = await preview(...args);
            return result.status === "ready"
              ? {
                  ...result,
                  preview: {
                    ...result.preview,
                    expectedRevision: 1,
                    expectedDigest: "1".repeat(64),
                  },
                }
              : result;
          };
        }
        const before = config.configuration.snapshot("conv_retry");
        const insert = config.storage.inputs.insert.bind(config.storage.inputs);
        const append = config.storage.events.append.bind(config.storage.events);
        const changes: unknown[] = [];
        const unsubscribe = core.subscribe((change) => changes.push(change));
        if (failure === "queue")
          config.storage.inputs.insert = () => {
            throw new Error("Injected queue failure");
          };
        if (failure === "settlement")
          config.storage.events.append = (event) => {
            if (event.type === "tool_call_response")
              throw new Error("Injected settlement failure");
            return append(event);
          };
        if (failure !== "stale")
          await assert.rejects(
            core.resolveInteraction(approve("failed")),
            /Injected .* failure/,
          );
        else
          assert.equal(
            (await core.resolveInteraction(approve("failed"))).status,
            "refresh_required",
          );
        const pending = core
          .getSnapshot("conv_retry")
          .toolCalls.find((entry) => entry.id === call.id)!;
        assert.equal(pending.state, "awaiting_input");
        assert.ok(pending.interaction?.kind === "plan_review");
        assert.equal(
          pending.interaction.resolution,
          undefined,
          "failed approval remains actionable without restart",
        );
        if (failure !== "unrelated-edit")
          assert.deepEqual(pending.interaction, {
            kind: "plan_review",
            request,
          });
        if (failure === "queue" || failure === "settlement") {
          assert.equal(
            config.configuration.snapshot("conv_retry").agentProfile,
            "coding",
          );
          assert.equal(config.storage.inputs.list("conv_retry").length, 0);
          assert.equal(
            changes.some(
              (change) => (change as { kind: string }).kind === "queue_changed",
            ),
            false,
          );
          assert.equal(
            changes.some((change) => {
              const value = change as {
                kind: string;
                event?: { type: string };
              };
              return (
                value.kind === "event_appended" &&
                value.event?.type === "tool_call_response"
              );
            }),
            false,
          );
        } else
          assert.deepEqual(config.configuration.snapshot("conv_retry"), before);
        unsubscribe();
        config.storage.inputs.insert = insert;
        config.storage.events.append = append;
        assert.equal(
          core
            .getEventsSince("conv_retry", 0)
            .filter((event) => event.type === "tool_call_response").length,
          0,
        );
        if (failure !== "stale") {
          // Restore the durable snapshot at the crash boundary, before the
          // best-effort in-process reopen could run. Startup must only reopen.
          config.storage.toolCalls.update(call.id, {
            interaction: {
              kind: "plan_review",
              request,
              resolution: approve("failed").resolution,
              resolutionRequestId: "failed",
            },
          });
        }
        if (failure === "unrelated-edit") {
          config.configuration.profiles.apply = async () => {
            throw new Error("Pending retry must never apply");
          };
          assert.equal(
            (await core.resolveInteraction(approve("failed"))).status,
            "refresh_required",
          );
          const reopened = core
            .getSnapshot("conv_retry")
            .toolCalls.find((entry) => entry.id === call.id)!;
          assert.ok(reopened.interaction?.kind === "plan_review");
          assert.equal(reopened.interaction.resolution, undefined);
          request = reopened.interaction.request;
          assert.equal(request.expectedRevision, 1);
          assert.equal(config.storage.inputs.list("conv_retry").length, 0);
        } else if (failure !== "stale") {
          const saved = config.configuration.snapshot("conv_retry");
          await core.close();
          config = makeOptions();
          config.configuration.update("conv_retry", saved);
          config.readPlan = async () =>
            "# Changed file must not replace reviewed copy";
          config.planApprovalProfile = async () => "coding";
          apply = config.configuration.profiles.apply;
          config.configuration.profiles.apply = async () => {
            throw new Error("Recovery must never apply");
          };
          core = new ConversationCore(config);
          await core.start();
          const reopened = core
            .getSnapshot("conv_retry")
            .toolCalls.find((entry) => entry.id === call.id)!;
          assert.equal(reopened.interaction?.resolution, undefined);
          assert.equal(config.storage.inputs.list("conv_retry").length, 0);
          assert.equal(
            config.storage.events
              .since("conv_retry", 0)
              .filter((event) => event.type === "tool_call_response").length,
            0,
          );
        }
        config.configuration.profiles.apply = apply;
        assert.equal(
          (await core.resolveInteraction(approve("fresh"))).status,
          "applied",
        );
        await waitUntil(
          () => core.getSnapshot("conv_retry").conversation.status === "idle",
        );
        assert.equal(
          core
            .getEventsSince("conv_retry", 0)
            .filter((event) => event.type === "tool_call_response").length,
          1,
        );
      } finally {
        await core.close();
        provider.unregister();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
