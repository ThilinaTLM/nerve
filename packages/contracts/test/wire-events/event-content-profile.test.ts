import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_EVENT_MAX_STRING_CHARS,
  validatePublicEvent,
} from "../../src/events/index.js";

/**
 * Content-sized events (conversation.entry.appended) must accept authoritative
 * content strings of any length while metadata events keep the strict
 * per-string bound. Regression for runs failing with
 * `["finalText"]: "public text is too long"` when model thinking exceeded
 * PUBLIC_EVENT_MAX_STRING_CHARS.
 */

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry_test",
    conversationId: "conv_test",
    agentId: "agent_test",
    runId: "run_test",
    turnId: "turn_test",
    liveMessageId: "msg_test",
    messageOrdinal: 0,
    role: "assistant",
    kind: "message",
    text: "Short prose.",
    details: {
      thinkingBlocks: [{ text: "Short thinking." }],
    },
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function entryAppended(entryPayload: Record<string, unknown>) {
  return {
    conversationId: "conv_test",
    agentId: "agent_test",
    runId: "run_test",
    turnId: "turn_test",
    liveMessageId: "msg_test",
    entry: entryPayload,
  };
}

describe("conversation event content profile", () => {
  it("accepts an entry with a thinking block longer than the strict string cap", () => {
    const longThinking = "x".repeat(PUBLIC_EVENT_MAX_STRING_CHARS + 500);
    const parsed = validatePublicEvent(
      "conversation.entry.appended",
      entryAppended(
        entry({
          details: { thinkingBlocks: [{ text: longThinking }] },
        }),
      ),
      "workbench_server",
    ) as { entry: { details: { thinkingBlocks: Array<{ text: string }> } } };
    assert.equal(parsed.entry.details.thinkingBlocks[0]?.text, longThinking);
  });

  it("accepts an entry with a long assistant text", () => {
    const longText = "y".repeat(PUBLIC_EVENT_MAX_STRING_CHARS + 100);
    const parsed = validatePublicEvent(
      "conversation.entry.appended",
      entryAppended(entry({ text: longText })),
      "workbench_server",
    ) as { entry: { text: string } };
    assert.equal(parsed.entry.text, longText);
  });

  it("still enforces a total byte ceiling for content events", () => {
    // 1 MiB cap: a payload well over it must be rejected even without a
    // per-string cap.
    const oversized = entry({
      details: {
        thinkingBlocks: [{ text: "z".repeat(1024 * 1024) }],
      },
    });
    assert.throws(() =>
      validatePublicEvent(
        "conversation.entry.appended",
        entryAppended(oversized),
        "workbench_server",
      ),
    );
  });

  it("rejects secret-like keys even on content events", () => {
    assert.throws(() =>
      validatePublicEvent(
        "conversation.entry.appended",
        entryAppended(entry({ details: { apiKey: "nope" } })),
        "workbench_server",
      ),
    );
  });
});

describe("conversation.live.content.done", () => {
  it("parses without finalText and keeps the redacted flag", () => {
    const parsed = validatePublicEvent(
      "conversation.live.content.done",
      {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_test",
        contentIndex: 0,
        kind: "thinking",
        redacted: false,
      },
      "workbench_server",
    ) as { finalText?: string; redacted?: boolean };
    assert.equal(parsed.finalText, undefined);
    assert.equal(parsed.redacted, false);
  });
});

describe("strict guard still applies to metadata events", () => {
  it("rejects a content delta chunk longer than the strict string cap", () => {
    assert.throws(() =>
      validatePublicEvent(
        "conversation.live.content.delta",
        {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          turnId: "turn_test",
          liveMessageId: "msg_test",
          contentBlockId: "block_test",
          contentIndex: 0,
          kind: "text",
          offset: 0,
          delta: "d".repeat(PUBLIC_EVENT_MAX_STRING_CHARS + 1),
        },
        "workbench_server",
      ),
    );
  });
});
