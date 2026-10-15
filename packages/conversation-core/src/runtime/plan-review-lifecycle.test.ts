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
                name: "plan_mode_present",
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
        config.readPlan = async () =>
          "# Implementation plan\n\nA reviewed snapshot.";
        return config;
      };
      let core = new ConversationCore(makeOptions());
      try {
        await core.start();
        await createConversation(core, "conv_plan");
        core.configure("conv_plan", { mode: "planning" });
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
        const resolution = {
          toolCallId: call.id,
          resolutionRequestId: "resolution_plan",
          resolution: {
            kind: "plan_review" as const,
            decision: scenario.decision,
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
          core.getSnapshot("conv_plan").config.mode,
          scenario.decision === "approve" ? "coding" : "planning",
        );
        if (scenario.decision === "approve") {
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
        assert.equal(core.getSnapshot("conv_plan").config.mode, "planning");
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
