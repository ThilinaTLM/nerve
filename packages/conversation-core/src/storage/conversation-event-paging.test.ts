import assert from "node:assert/strict";
import { test } from "node:test";
import type { SQLOutputValue } from "node:sqlite";
import { conversationEventSchema } from "@nervekit/contracts/core";
import { byteLimitedRows } from "./conversation-event.repository.js";

type Row = Record<string, SQLOutputValue>;
const row = (sequence: number, text: string): Row => ({
  id: `evt_${sequence}`,
  conversation_id: "conv_1",
  sequence,
  previous_event_id: sequence > 1 ? `evt_${sequence - 1}` : null,
  event_type: "tool_call_response",
  llm_representation: "user",
  turn_id: null,
  input_id: null,
  created_at: "2026-10-10T00:00:00.000Z",
  payload: JSON.stringify({
    toolCallId: "tool_1",
    providerCallId: null,
    toolName: "bash",
    arguments: {},
    origin: "user",
    assistantEventId: null,
    contentIndex: null,
    outcome: "completed",
    agentProjection: [{ type: "text", text: "huge".repeat(10000) }],
    userProjection: { argsPreview: {}, resultPreview: text },
    supervision: null,
    interactionResolution: null,
    resolutionRequestId: null,
    assetIds: [],
  }),
});
const map = (r: Row) =>
  conversationEventSchema.parse({
    id: r.id,
    conversationId: r.conversation_id,
    sequence: r.sequence,
    previousEventId: r.previous_event_id,
    type: r.event_type,
    llmRepresentation: r.llm_representation,
    turnId: r.turn_id,
    inputId: r.input_id,
    payload: JSON.parse(String(r.payload)),
    createdAt: r.created_at,
  });

test("row pages are sized from stored payload bytes, omit agent projections and always make progress", () => {
  const rows = [row(1, "界".repeat(50)), row(2, "x"), row(3, "x")];
  const first = byteLimitedRows(rows, map)[0];
  assert.equal(first.type, "tool_call_response");
  assert.ok(!("agentProjection" in first.payload));
  const sizes = rows.map((r) => Buffer.byteLength(String(r.payload)) + 512);
  // Raw bytes upper-bound the transferred JSON, so a page never exceeds its cap.
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= sizes[0]);
  const cap = 2 + sizes[0] + sizes[1] + 1;
  assert.equal(byteLimitedRows(rows, map, cap).length, 2);
  assert.equal(byteLimitedRows(rows, map, cap - 1).length, 1);
  assert.equal(byteLimitedRows(rows, map, 1).length, 1);
  assert.equal(byteLimitedRows([], map, 1).length, 0);
});
