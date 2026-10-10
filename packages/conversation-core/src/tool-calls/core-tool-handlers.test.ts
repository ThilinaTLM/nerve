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
