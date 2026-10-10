import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentProjectionSnapshotSchema,
  relatedCollectionPageSchema,
  toolMutationSummarySchema,
  validatedToolArtifactSchema,
} from "../../src/domains/tools/index.js";

import {
  conversationEventSchema,
  transferConversationEvent,
} from "../../src/domains/core/event.js";
import { assistantEvent } from "../wire-events/core-event-fixtures.js";

const artifact = {
  version: 1 as const,
  id: "complete_payload",
  role: "overflow_recovery" as const,
  access: { kind: "agent_file" as const, path: "/tmp/result.json" },
  availability: "available" as const,
  format: {
    kind: "json" as const,
    mediaType: "application/json",
    encoding: "utf-8" as const,
  },
  size: { bytes: 10 },
  recommendedTools: ["read" as const],
  label: "Complete payload",
};

describe("agent projection contracts", () => {
  it("keeps the agent projection out of transferred tool responses", () => {
    const event = conversationEventSchema.parse({
      ...assistantEvent(),
      type: "tool_call_response",
      llmRepresentation: "tool_result",
      payload: {
        toolCallId: "tool_test",
        providerCallId: "provider_test",
        toolName: "read",
        arguments: { path: "file.txt" },
        origin: "model",
        assistantEventId: "evt_test",
        contentIndex: 0,
        outcome: "completed",
        agentProjection: [{ type: "text", text: "Large agent-only result" }],
        userProjection: {
          argsPreview: { path: "file.txt" },
          resultPreview: "Preview",
        },
        supervision: null,
        interactionResolution: null,
        resolutionRequestId: null,
        assetIds: [],
      },
    });
    const transferred = transferConversationEvent(event);
    assert.equal("agentProjection" in transferred.payload, false);
    if (transferred.type === "tool_call_response")
      assert.equal(transferred.payload.userProjection.resultPreview, "Preview");
  });
  it("requires unavailable reasons and compatible inspection access", () => {
    assert.equal(validatedToolArtifactSchema.safeParse(artifact).success, true);
    assert.equal(
      validatedToolArtifactSchema.safeParse({
        ...artifact,
        availability: "unavailable",
      }).success,
      false,
    );
    assert.equal(
      validatedToolArtifactSchema.safeParse({
        ...artifact,
        access: { kind: "metadata_only" },
      }).success,
      false,
    );
  });

  it("accepts normalized mutation, related-page, and task-log strategy metadata", () => {
    assert.equal(
      toolMutationSummarySchema.safeParse({
        operation: "edit",
        outcome: "dry_run",
        resources: [{ kind: "file", path: "/tmp/file.txt" }],
        warnings: [],
      }).success,
      true,
    );
    assert.equal(
      relatedCollectionPageSchema.safeParse({
        id: "comments",
        original: 10,
        returned: 3,
        continuation: {
          parameter: "comment_start_at",
          value: 3,
          direction: "after",
        },
      }).success,
      true,
    );
    assert.equal(
      agentProjectionSnapshotSchema.safeParse({
        version: 1,
        profile: "task_logs",
        strategy: "task_log_window",
        terminalOutcomePrecedence: false,
        fastPath: false,
        recovery: "artifact",
        artifactRoles: ["supporting_data"],
        counts: [],
        originalTextBytes: 10,
        displayedTextBytes: 10,
        originalTextLines: 1,
        displayedTextLines: 1,
      }).success,
      true,
    );
  });
});
