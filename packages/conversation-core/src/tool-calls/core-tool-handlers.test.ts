import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall } from "@nervekit/contracts/core";
import { askUserResultSchema } from "@nervekit/contracts/tools";
import type { AssetStore } from "../assets/asset-store.js";
import { createCoreToolHandlers } from "./core-tool-handlers.js";

const handler = createCoreToolHandlers({
  assets: {} as AssetStore,
  configure() {},
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
    { question: "Which?", context: "ctx", response: "Blue" },
  );
});

test("ask_user dismissal resolves with an explicit dismissed flag", async () => {
  assert.deepEqual(
    await resolveContent({ kind: "user_input", answers: {}, dismissed: true }),
    { question: "Which?", context: "ctx", dismissed: true },
  );
});

test("agents have no planning-mode entry or force-exit handlers", () => {
  const handlers = createCoreToolHandlers({
    assets: {} as AssetStore,
    configure() {},
  });
  assert.equal(handlers.has("plan_mode_enter"), false);
  assert.equal(handlers.has("plan_mode_force_exit"), false);
  assert.ok(handlers.has("plan_mode_present"));
});

function planReview() {
  const changes: unknown[] = [];
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
    configure(conversationId, patch) {
      changes.push({ conversationId, patch });
    },
  }).get("plan_mode_present")!;
  return { changes, planCall, planHandler };
}

test("presenting a plan requests review without changing mode", async () => {
  const { changes, planCall, planHandler } = planReview();
  const outcome = await planHandler.execute(planCall, ctx);
  assert.equal(outcome.kind, "awaiting_input");
  if (outcome.kind !== "awaiting_input") assert.fail("Expected plan review");
  assert.equal(outcome.interaction.kind, "plan_review");
  assert.deepEqual(changes, []);
});

test("user approval of a plan switches the conversation to coding", async () => {
  const { changes, planCall, planHandler } = planReview();
  const result = await planHandler.resolve!(
    planCall,
    { kind: "plan_review", decision: "approve" },
    ctx,
  );
  assert.deepEqual(changes, [
    { conversationId: "conv_1", patch: { mode: "coding" } },
  ]);
  assert.match(result.content ?? "", /Plan approved/);
});

test("user rejection of a plan leaves mode unchanged and returns feedback", async () => {
  const { changes, planCall, planHandler } = planReview();
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
});
