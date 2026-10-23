import { testConfiguration } from "../runtime/configuration-test-helper.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall } from "@nervekit/contracts/core";
import { askUserResultSchema } from "@nervekit/contracts/tools";
import type { AssetStore } from "../assets/asset-store.js";
import {
  createCoreToolHandlers,
  type CoreToolHandlerOptions,
} from "./core-tool-handlers.js";

const fakeProfiles = () =>
  testConfiguration({ prepare: async () => ({ systemPrompt: "", tools: [] }) })
    .profiles;
const handler = createCoreToolHandlers({
  assets: {} as AssetStore,
  profiles: fakeProfiles(),
  onPlanRejected() {},
}).get("ask_user");
const call = {
  toolName: "ask_user",
  arguments: { question: "Which?", context: "ctx" },
} as unknown as ToolCall;
const ctx = {
  conversationId: "conv_1",
  signal: new AbortController().signal,
  onProgress() {},
};

async function resolveContent(
  resolution: Parameters<NonNullable<typeof handler>["resolve"] & {}>[1],
) {
  const result = await handler?.resolve?.(call, resolution, ctx);
  return askUserResultSchema.parse(JSON.parse(result?.content ?? ""));
}

test("ask_user answer resolves to the canonical card result", async () => {
  assert.deepEqual(
    await resolveContent({ kind: "user_input", answers: { answer: "Blue" } }),
    {
      questions: [
        { id: "answer", question: "Which?", answer: { text: "Blue" } },
      ],
    },
  );
});

test("ask_user dismissal resolves with an explicit dismissed flag", async () => {
  assert.deepEqual(
    await resolveContent({ kind: "user_input", answers: {}, dismissed: true }),
    {
      questions: [{ id: "answer", question: "Which?", skipped: true }],
      dismissed: true,
    },
  );
});

test("ask_user stores a normalized multi-question request", async () => {
  const outcome = await handler!.execute(
    {
      ...call,
      arguments: { questions: [{ question: "One?" }, { question: "Two?" }] },
    },
    ctx,
  );
  assert.deepEqual(outcome, {
    kind: "awaiting_input",
    interaction: {
      kind: "user_input",
      request: {
        questions: [
          { id: "q1", question: "One?" },
          { id: "q2", question: "Two?" },
        ],
      },
    },
  });
});

test("ask_user resolves all answers, trims option and text, and skips missing or empty answers", async () => {
  const multiCall = {
    ...call,
    arguments: {
      questions: [
        { id: "one", question: "One?" },
        { id: "two", question: "Two?" },
        { id: "three", question: "Three?" },
        { id: "four", question: "Four?" },
      ],
    },
  };
  const resolve = async (
    answers: Record<
      string,
      string | string[] | { option?: string; text?: string }
    >,
  ) => {
    const result = await handler!.resolve!(
      multiCall,
      { kind: "user_input", answers },
      ctx,
    );
    return askUserResultSchema.parse(JSON.parse(result.content!));
  };
  assert.deepEqual(
    await resolve({
      one: " A ",
      two: [" B ", "C"],
      three: { option: " Yes ", text: " because " },
      four: "Done",
    }),
    {
      questions: [
        { id: "one", question: "One?", answer: { text: "A" } },
        { id: "two", question: "Two?", answer: { text: "B, C" } },
        {
          id: "three",
          question: "Three?",
          answer: { option: "Yes", text: "because" },
        },
        { id: "four", question: "Four?", answer: { text: "Done" } },
      ],
    },
  );
  assert.deepEqual(
    await resolve({ one: "A", three: { option: " ", text: " " }, four: [] }),
    {
      questions: [
        { id: "one", question: "One?", answer: { text: "A" } },
        { id: "two", question: "Two?", skipped: true },
        { id: "three", question: "Three?", skipped: true },
        { id: "four", question: "Four?", skipped: true },
      ],
    },
  );
});

test("agents have no profile entry or force-exit handlers", () => {
  const handlers = createCoreToolHandlers({
    assets: {} as AssetStore,
    profiles: fakeProfiles(),
    onPlanRejected() {},
  });
  assert.equal(handlers.has("plan_mode_enter"), false);
  assert.equal(handlers.has("plan_mode_force_exit"), false);
  assert.ok(handlers.has("plan_present"));
});

function planReview(
  planApprovalProfile: NonNullable<
    CoreToolHandlerOptions["planApprovalProfile"]
  > = async () => "implementation",
) {
  const changes: unknown[] = [];
  const rejections: string[] = [];
  const planCall = {
    id: "tc_plan",
    conversationId: "conv_1",
    toolName: "plan_present",
    arguments: { file_path: "/plans/implementation.md" },
    interaction: {
      kind: "plan_review",
      request: {
        targetProfile: { name: "implementation", digest: "0".repeat(64) },
        expectedRevision: 0,
        expectedDigest: "missing",
        assetId: "asset_plan",
        path: "/plan.md",
      },
    },
  } as unknown as ToolCall;
  const profiles = fakeProfiles();
  const apply = profiles.apply;
  profiles.apply = async (input) => {
    changes.push({
      conversationId: input.conversationId,
      profile: input.targetProfile.name,
      overrides: input.choices,
    });
    return apply(input);
  };
  const planHandler = createCoreToolHandlers({
    profiles,
    assets: {
      async write() {
        return {
          id: "asset_plan",
          logicalPath: "conversations/conv_1/tool-calls/tc_plan/plan.md",
        };
      },
      path(logicalPath: string) {
        return `/storage/${logicalPath}`;
      },
    } as unknown as AssetStore,
    planApprovalProfile,
    async readPlan() {
      return "# Implementation plan\n\nImplement the approved approach.";
    },
    onPlanRejected(conversationId) {
      rejections.push(conversationId);
    },
  }).get("plan_present")!;
  return { changes, rejections, planCall, planHandler };
}

test("presenting a plan requests review without changing agentProfile", async () => {
  const { changes, rejections, planCall, planHandler } = planReview();
  const outcome = await planHandler.execute(planCall, ctx);
  assert.equal(outcome.kind, "awaiting_input");
  if (outcome.kind !== "awaiting_input") assert.fail("Expected plan review");
  assert.equal(outcome.interaction.kind, "plan_review");
  if (outcome.interaction.kind === "plan_review")
    assert.equal(
      outcome.interaction.request.targetProfile.name,
      "implementation",
    );
  assert.deepEqual(rejections, []);
  assert.deepEqual(changes, []);
});

test("user approval of a plan switches to the captured profile with approved model and thinking", async () => {
  const { changes, rejections, planCall, planHandler } = planReview();
  const result = await planHandler.resolve!(
    planCall,
    {
      kind: "plan_review",
      decision: "approve",
      confirmation: {
        targetProfile: { name: "implementation", digest: "0".repeat(64) },
        expectedRevision: 0,
        expectedDigest: "missing",
        transitionId: "approve-plan",
        choices: {
          model: { provider: "openai", modelId: "approved" },
          reasoningLevel: "high",
        },
      },
    },
    ctx,
  );
  assert.deepEqual(changes, [
    {
      conversationId: "conv_1",
      profile: "implementation",
      overrides: {
        model: { provider: "openai", modelId: "approved" },
        reasoningLevel: "high",
      },
    },
  ]);
  assert.ok("kind" in result && result.kind === "profile_transition");
  assert.match(result.result.content ?? "", /Plan approved/);
  assert.deepEqual(rejections, []);
});

test("user rejection gates automatic work, leaves agentProfile unchanged and returns feedback", async () => {
  const { changes, rejections, planCall, planHandler } = planReview();
  const result = await planHandler.resolve!(
    planCall,
    {
      kind: "plan_review",
      decision: "reject",
      feedback: "Use a smaller scope.",
    },
    ctx,
  );
  assert.deepEqual(changes, []);
  assert.equal(result.content, "Plan rejected. Use a smaller scope.");
  assert.deepEqual(rejections, ["conv_1"]);
});

test("plan review uses its request-captured approval profile rather than the latest selection", async () => {
  let currentProfile = "initial";
  const capturedProfiles = new Map([["request-plan", currentProfile]]);
  const { planHandler, planCall } = planReview(
    async (conversationId, requestCaptureId) => {
      assert.equal(conversationId, planCall.conversationId);
      return requestCaptureId
        ? capturedProfiles.get(requestCaptureId)!
        : currentProfile;
    },
  );
  currentProfile = "changed";
  const captured = await planHandler.execute(planCall, {
    ...ctx,
    requestCaptureId: "request-plan",
  });
  if (
    captured.kind !== "awaiting_input" ||
    captured.interaction.kind !== "plan_review"
  )
    assert.fail("Expected captured plan review");
  assert.equal(captured.interaction.request.targetProfile.name, "initial");
  // Recovered calls have no process-local identity, so their callback recaptures current settings.
  const recovered = await planHandler.execute(planCall, ctx);
  if (
    recovered.kind !== "awaiting_input" ||
    recovered.interaction.kind !== "plan_review"
  )
    assert.fail("Expected recaptured plan review");
  assert.equal(recovered.interaction.request.targetProfile.name, "changed");
});
