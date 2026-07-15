import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationEntry, ToolCallTranscriptRecord } from "$lib/api";
import {
  boundedHistoryExcerpt,
  buildHistoryEntryView,
} from "./history-entry-view";

function entry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: "entry_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    role: "assistant",
    kind: "message",
    text: "Hello",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function toolRecord(
  overrides: Partial<ToolCallTranscriptRecord> = {},
): ToolCallTranscriptRecord {
  return {
    id: "tool_01H000000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName: "bash",
    risk: "read_only",
    args: {},
    argsPreview: { command: "pwd" },
    resultPreview: "/tmp/project",
    cwd: "/tmp/project",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ToolCallTranscriptRecord;
}

function toolMap(record: ToolCallTranscriptRecord) {
  return new Map([[record.id, record]]);
}

function toolDetails(record: ToolCallTranscriptRecord) {
  return {
    toolName: record.toolName,
    toolRecordId: record.id,
  };
}

describe("buildHistoryEntryView", () => {
  it("builds prose and thinking content", () => {
    const view = buildHistoryEntryView(
      entry({
        text: "Visible answer",
        details: { thinkingBlocks: [{ text: "Reasoning" }] },
      }),
      new Map(),
    );
    assert.equal(view.messageText, "Visible answer");
    assert.equal(view.thinkingText, "Reasoning");
    assert.equal(view.isToolEntry, false);
    assert.equal(view.detailPreview, "Visible answer");
  });

  it("resolves formatted tool arguments and result", () => {
    const record = toolRecord();
    const view = buildHistoryEntryView(
      entry({
        role: "system",
        text: "/tmp/project",
        details: toolDetails(record),
      }),
      toolMap(record),
    );
    assert.equal(view.toolName, "bash");
    assert.match(view.argsText, /"command": "pwd"/);
    assert.equal(view.resultText, "/tmp/project");
    assert.equal(view.detailPreview, "Result\n/tmp/project");
  });

  it("prioritizes tool errors in the graph preview", () => {
    const record = toolRecord({ status: "error", error: "command failed" });
    const view = buildHistoryEntryView(
      entry({
        role: "system",
        text: "",
        details: toolDetails(record),
      }),
      toolMap(record),
    );
    assert.equal(view.errorText, "command failed");
    assert.equal(view.detailPreview, "Error\ncommand failed");
  });

  it("handles tool placeholders without transcript records", () => {
    const view = buildHistoryEntryView(
      entry({ text: "[Tool call: read()]" }),
      new Map(),
    );
    assert.equal(view.isToolEntry, true);
    assert.equal(view.toolName, "read");
    assert.equal(view.argsText, "");
  });
});

describe("boundedHistoryExcerpt", () => {
  it("bounds long values without changing short values", () => {
    assert.equal(boundedHistoryExcerpt(" short ", 20), "short");
    assert.equal(boundedHistoryExcerpt("abcdefghij", 6), "abcde…");
  });
});
