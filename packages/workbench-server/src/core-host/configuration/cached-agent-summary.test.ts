import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ConversationSnapshot,
  ConversationSummary,
} from "@nervekit/contracts/core";
import {
  cachedConversationSnapshot,
  cachedConversationSummary,
} from "./cached-agent-summary.js";

await test("missing summary cache leaves history usable; cached values are display-only and omit digest metadata", () => {
  const row = { id: "conversation", title: "history" } as ConversationSummary;
  const empty = { getSummary: () => undefined };
  assert.deepEqual(cachedConversationSummary(empty, row), row);
  const snapshot = {
    conversation: { id: row.id },
    config: {
      conversationId: row.id,
      systemPrompt: null,
      instructions: "context",
      workingDirectory: "/project",
    },
    children: [],
  } as unknown as ConversationSnapshot;
  assert.equal(
    cachedConversationSnapshot(empty, snapshot).config.instructions,
    "context",
  );
  const cached = {
    getSummary: () => ({
      model: { provider: "display", modelId: "last-known" },
      observedDigest: "0".repeat(64),
    }),
  };
  const projected = cachedConversationSnapshot(cached, snapshot);
  assert.deepEqual(projected.config.model, {
    provider: "display",
    modelId: "last-known",
  });
  assert.equal("observedDigest" in projected.config, false);
  assert.equal(snapshot.config.model, undefined);
});
