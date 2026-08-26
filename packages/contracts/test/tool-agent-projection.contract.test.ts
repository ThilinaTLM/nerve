import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toolCallRecordSchema,
  toolCallTranscriptRecordSchema,
  validatedToolArtifactSchema,
} from "../src/index.js";

const now = "2026-08-27T00:00:00.000Z";
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

  it("keeps host projection metadata out of transcript records", () => {
    const record = toolCallRecordSchema.parse({
      id: "tool_test",
      agentId: "agent_test",
      conversationId: "conv_test",
      projectId: "proj_test",
      toolName: "read",
      risk: "read",
      args: { path: "file.txt" },
      cwd: "/tmp",
      status: "completed",
      revision: 1,
      attempt: 1,
      interactions: [],
      validatedArtifacts: [artifact],
      agentProjection: {
        version: 1,
        profile: "source_text",
        strategy: "unchanged",
        terminalOutcomePrecedence: false,
        fastPath: true,
        recovery: "none",
        artifactRoles: ["overflow_recovery"],
        counts: [],
        originalTextBytes: 2,
        displayedTextBytes: 2,
        originalTextLines: 1,
        displayedTextLines: 1,
      },
      createdAt: now,
      updatedAt: now,
      settledAt: now,
    });
    const transcript = toolCallTranscriptRecordSchema.parse(record);
    assert.equal("validatedArtifacts" in transcript, false);
    assert.equal("agentProjection" in transcript, false);
  });
});
