import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall } from "@nervekit/contracts/core";
import { askUserResultSchema } from "@nervekit/contracts/tools";
import type { AssetStore } from "../assets/asset-store.js";
import { createCoreToolHandlers } from "./core-tool-handlers.js";

const handler = createCoreToolHandlers({
  assets: {} as AssetStore,
  configure() {},
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

test("agents have no planning-mode entry or force-exit handlers", () => {
  const handlers = createCoreToolHandlers({
    assets: {} as AssetStore,
    configure() {},
    onPlanRejected() {},
  });
  assert.equal(handlers.has("plan_mode_enter"), false);
  assert.equal(handlers.has("plan_mode_force_exit"), false);
  assert.ok(handlers.has("plan_mode_present"));
});

function planReview() {
  const changes: unknown[] = [];
  const rejections: string[] = [];
  const planCall = {
    id: "tc_plan",
    conversationId: "conv_1",
    toolName: "plan_mode_present",
    arguments: { file_path: "/plans/implementation.md" },
  } as unknown as ToolCall;
  const planHandler = createCoreToolHandlers({
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
    async readPlan() {
      return "# Implementation plan\n\nImplement the approved approach.";
    },
    onPlanRejected(conversationId) {
      rejections.push(conversationId);
    },
    configure(conversationId, patch) {
      changes.push({ conversationId, patch });
    },
  }).get("plan_mode_present")!;
  return { changes, rejections, planCall, planHandler };
}

test("presenting a plan requests review without changing mode", async () => {
  const { changes, rejections, planCall, planHandler } = planReview();
  const outcome = await planHandler.execute(planCall, ctx);
  assert.equal(outcome.kind, "awaiting_input");
  if (outcome.kind !== "awaiting_input") assert.fail("Expected plan review");
  assert.equal(outcome.interaction.kind, "plan_review");
  assert.deepEqual(rejections, []);
  assert.deepEqual(changes, []);
});

test("user approval of a plan switches the conversation to coding", async () => {
  const { changes, rejections, planCall, planHandler } = planReview();
  const result = await planHandler.resolve!(
    planCall,
    { kind: "plan_review", decision: "approve" },
    ctx,
  );
  assert.deepEqual(changes, [
    { conversationId: "conv_1", patch: { mode: "coding" } },
  ]);
  assert.match(result.content ?? "", /Plan approved/);
  assert.deepEqual(rejections, []);
});

test("user rejection gates automatic work, leaves mode unchanged and returns feedback", async () => {
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
