import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueuedPromptRecord } from "../view-models/conversation";
import { entryToTranscriptItem } from "../state/transcript";
import { buildCommittedTimeline } from "../state/timeline";
import {
  acceptedPromptRow,
  entranceEligible,
  transcriptMessageMarks,
  transcriptRowIndexOfEntry,
} from "./transcript-row-model";

const prompt: QueuedPromptRecord = {
  id: "input-1",
  agentId: "conversation",
  conversationId: "conversation",
  projectId: "project",
  text: "Review changes",
  behavior: "follow-up",
  status: "queued",
  presentation: "starting",
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
};
test("accepted and delivered user messages retain the same row key and event action identity", () => {
  const pending = acceptedPromptRow(prompt);
  const delivered = entryToTranscriptItem({
    id: "event-1",
    inputId: prompt.id,
    conversationId: prompt.conversationId,
    role: "user",
    kind: "message",
    text: prompt.text,
    createdAt: prompt.createdAt,
  });
  assert.ok(delivered);
  const timeline = buildCommittedTimeline([delivered], []);
  assert.equal(timeline.items[0].key, pending.key);
  assert.equal(delivered.id, "event-1");
  assert.equal(entranceEligible(pending.node), false);
  assert.equal(entranceEligible(timeline.items[0]), false);
});

test("message marks index user messages and entries resolve to rows", () => {
  const rows = [
    acceptedPromptRow(prompt),
    {
      kind: "timeline" as const,
      key: "a1",
      node: {
        kind: "message" as const,
        key: "a1",
        item: { id: "a1:text:0", role: "assistant" as const, text: "Done" },
      },
    },
    { kind: "activity" as const, key: "__activity__" },
  ];
  assert.deepEqual(transcriptMessageMarks(rows), [
    { index: 0, key: "input:input-1", text: "Review changes" },
  ]);
  assert.equal(transcriptRowIndexOfEntry(rows, "a1"), 1);
  assert.equal(transcriptRowIndexOfEntry(rows, "missing"), undefined);
});
