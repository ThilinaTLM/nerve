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
    feedback: undefined,
    recoverPending: false,
    sibling: false,
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
        config.turnResources.prepare = async () => {
          modelTurns++;
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
        await core.resolveInteraction(resolution);
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

for (const failure of ["stale", "persistence"] as const) {
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
      const config = options(
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
      config.readPlan = async () => "# Plan";
      config.planApprovalProfile = async () => "coding";
      const apply = config.configuration.profiles.apply;
      const refresh = {
        status: "refresh_required" as const,
        reason: "configuration_changed" as const,
        diagnostics: [],
      };
      config.configuration.profiles.apply = async () => {
        if (failure === "persistence")
          throw new Error("Injected persistence failure");
        return refresh;
      };
      config.configuration.profiles.reconcile = async () => refresh;
      const core = new ConversationCore(config);
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
        const request = call.interaction.request;
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
            },
          },
        });
        const before = config.configuration.snapshot("conv_retry");
        if (failure === "persistence")
          await assert.rejects(
            core.resolveInteraction(approve("failed")),
            /persistence failure/,
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
        assert.deepEqual(pending.interaction, { kind: "plan_review", request });
        assert.deepEqual(config.configuration.snapshot("conv_retry"), before);
        assert.equal(
          core
            .getEventsSince("conv_retry", 0)
            .filter((event) => event.type === "tool_call_response").length,
          0,
        );
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
