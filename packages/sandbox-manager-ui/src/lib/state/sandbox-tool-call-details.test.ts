import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SandboxToolCallGetResult,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";
import type { ConversationRenderState } from "@nervekit/shared-ui/state";
import {
  resolveToolCallDetails,
  sandboxToolCallGetResultToToolCallRecord,
} from "./sandbox-tool-call-details";

const preview: ToolCallTranscriptRecord = {
  id: "tool_normalized",
  sourceToolCallId: "raw_bash_1",
  providerToolCallId: "provider_bash_1",
  conversationId: "conv_details",
  agentId: "agent_main",
  projectId: "proj_sandbox_details",
  runId: "run_details",
  toolName: "bash",
  risk: "command",
  cwd: "/workspace",
  status: "running",
  argsPreview: { command: "echo preview" },
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:01.000Z",
};

const fetched: SandboxToolCallGetResult = {
  toolCall: {
    toolCallId: "raw_bash_1",
    conversationId: "conv_details",
    agentId: "agent_main",
    runId: "run_details",
    toolName: "bash",
    status: "completed",
    displayArgs: { command: "echo fetched" },
    result: { content: "fetched\n", exitCode: 0 },
    lifecycleSeq: 3,
    redactionVersion: 1,
    requestedAt: "2026-07-07T00:00:00.000Z",
    completedAt: "2026-07-07T00:00:02.000Z",
  },
  argsPreview: { command: "echo fetched" },
  resultPreview: { content: "fetched\n", exitCode: 0 },
};

describe("sandbox tool-call details", () => {
  it("converts fetched sandbox tool calls using the preview as stable identity", () => {
    const record = sandboxToolCallGetResultToToolCallRecord(fetched, preview);

    assert.equal(record.id, "tool_normalized");
    assert.equal(record.sourceToolCallId, "raw_bash_1");
    assert.equal(record.providerToolCallId, "raw_bash_1");
    assert.equal(record.projectId, "proj_sandbox_details");
    assert.equal(record.cwd, "/workspace");
    assert.equal(record.risk, "command");
    assert.equal(record.createdAt, preview.createdAt);
    assert.equal(record.updatedAt, preview.updatedAt);
    assert.equal(record.status, "completed");
    assert.deepEqual(record.args, { command: "echo fetched" });
    assert.deepEqual(record.result, { content: "fetched\n", exitCode: 0 });
  });

  it("falls back to promoted previews when disconnected or fetching fails", async () => {
    const state: ConversationRenderState = {
      conversationId: "conv_details",
      entries: [],
      activeEntryIds: [],
      toolCalls: [preview],
      cursorSeq: 0,
    };

    const disconnected = await resolveToolCallDetails(
      state,
      "sbx_details",
      "tool_normalized",
      {
        connected: false,
        fetchSandboxToolCall: async () => {
          assert.fail("fetch should not run while disconnected");
        },
      },
    );
    assert.deepEqual(disconnected.args, preview.argsPreview);
    assert.equal(disconnected.result, undefined);

    const failed = await resolveToolCallDetails(
      state,
      "sbx_details",
      "tool_normalized",
      {
        connected: true,
        fetchSandboxToolCall: async () => {
          throw new Error("controller unavailable");
        },
      },
    );
    assert.deepEqual(failed.args, preview.argsPreview);
    assert.equal(failed.status, preview.status);
  });
});
