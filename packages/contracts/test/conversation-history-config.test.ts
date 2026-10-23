import { test } from "node:test";
import {
  leadConversationAgentSchema,
  agentPreferencesSchema,
  profileDefinitionSchema,
} from "../src/domains/agent-configuration/schemas.js";
import assert from "node:assert/strict";
import {
  conversationConfigSchema,
  conversationHistoryConfigSchema,
  conversationSnapshotSchema,
} from "../src/domains/core/conversation.js";

await test("history context remains valid without agent fields; execution config still requires resolved choices", () => {
  const context = {
    conversationId: "conversation",
    systemPrompt: null,
    instructions: "history",
    workingDirectory: "/project",
  };
  assert.deepEqual(conversationHistoryConfigSchema.parse(context), context);
  assert.equal(conversationConfigSchema.safeParse(context).success, false);
  const now = "2026-01-01T00:00:00.000Z";
  const snapshot = conversationSnapshotSchema.parse({
    conversation: {
      id: "conversation",
      projectId: "project",
      parentConversationId: null,
      parentToolCallId: null,
      headEventId: null,
      title: "history",
      status: "idle",
      statusEventSequence: 0,
      statusClearedAt: null,
      paused: false,
      nextInputSequence: 1,
      pinnedAt: null,
      completedAt: null,
      lastUserMessageAt: null,
      createdAt: now,
      updatedAt: now,
    },
    config: context,
    lastSequence: 0,
    appliedAgentProfile: null,
    toolCalls: [],
    queue: [],
    asyncBash: [],
    children: [],
  });
  assert.equal(snapshot.config.model, undefined);
  assert.equal(snapshot.config.permissionRuleSetId, undefined);
  assert.equal(snapshot.config.instructions, "history");
  const unavailable = {
    conversationId: "conversation",
    workingDirectory: "/project",
  };
  assert.deepEqual(
    conversationHistoryConfigSchema.parse(unavailable),
    unavailable,
  );
  assert.equal(conversationConfigSchema.safeParse(unavailable).success, false);
});
await test("D10 context extends unreleased conversation v1 only and cannot enter inherited settings or profiles", () => {
  const context = { instructions: "  Exact context\n", systemPrompt: "" };
  const document = {
    schemaVersion: 1,
    revision: 0,
    overrides: {},
    appliedProfile: null,
    context,
  };
  assert.deepEqual(
    leadConversationAgentSchema.parse(document).context,
    context,
  );
  assert.equal(
    agentPreferencesSchema.safeParse({
      schemaVersion: 1,
      revision: 0,
      overrides: {},
      context,
    }).success,
    false,
  );
  assert.equal(
    leadConversationAgentSchema.safeParse({
      ...document,
      overrides: { context },
    }).success,
    false,
  );
  assert.equal(
    profileDefinitionSchema.safeParse({
      schemaVersion: 1,
      name: "coding",
      description: "Coding",
      usableBy: "lead",
      instructions: "Profile",
      context,
    }).success,
    false,
  );
});
