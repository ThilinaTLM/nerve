import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueuedPromptRecord } from "../view-models/conversation";
import { entryToTranscriptItem } from "../state/transcript";
import { buildCommittedTimeline } from "../state/timeline";
import {
  acceptedPromptRow,
  entranceEligible,
  measurementVersionForRow,
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
const context = {
  approvalsByToolCallId: new Map(),
  questionsByToolCallId: new Map(),
  reviewsByToolCallId: new Map(),
  active: true,
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
test("command preparation and expanded output invalidate row measurement even with unchanged acceptance time", () => {
  const pending = acceptedPromptRow(prompt);
  const running = acceptedPromptRow({
    ...prompt,
    commandPreparation: {
      blocks: [
        { index: 0, command: "git status", state: "running", result: null },
      ],
    },
  });
  const completed = acceptedPromptRow({
    ...prompt,
    preparedText: "Expanded command output",
    commandPreparation: {
      blocks: [
        {
          index: 0,
          command: "git status",
          state: "completed",
          result: { stdout: "clean", stderr: "", exitCode: 0 },
        },
      ],
    },
  });
  assert.notEqual(
    measurementVersionForRow(pending, context),
    measurementVersionForRow(running, context),
  );
  assert.notEqual(
    measurementVersionForRow(running, context),
    measurementVersionForRow(completed, context),
  );
});
