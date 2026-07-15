import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationActiveRunSnapshot } from "@nervekit/contracts";
import {
  activeRunStreamingText,
  drainMaterializedActiveRunMessages,
  liveBlockKey,
  materializedLiveMessagesFromEntries,
  orderedBlocks,
  orderedMessages,
  orderedTurns,
  removeActiveRunMessage,
  toolSlotKey,
} from "./active-run.js";
import {
  activeRun,
  draftBlock,
  liveMessage,
  runTurn,
  textBlock,
} from "./timeline.fixtures.js";

function run(): ConversationActiveRunSnapshot {
  return activeRun({
    turns: [
      runTurn("turn_2", 1, [
        liveMessage("msg_3", 0, [textBlock("text", 0, "second turn")]),
      ]),
      runTurn("turn_1", 0, [
        liveMessage("msg_2", 1, [
          textBlock("text", 2, "trailing"),
          draftBlock(1, { toolName: "bash" }),
          textBlock("thinking", 0, "reasoning", true),
        ]),
        liveMessage("msg_1", 0, [textBlock("text", 0, "first answer", true)]),
      ]),
    ],
  });
}

describe("active-run helpers", () => {
  it("iterates turns, messages, and blocks in canonical stream order", () => {
    const snapshot = run();
    const order = orderedTurns(snapshot).flatMap((turn) =>
      orderedMessages(turn).flatMap((message) =>
        orderedBlocks(message).map(
          (block) => `${message.liveMessageId}:${block.contentIndex}`,
        ),
      ),
    );
    assert.deepEqual(order, [
      "msg_1:0",
      "msg_2:0",
      "msg_2:1",
      "msg_2:2",
      "msg_3:0",
    ]);
  });

  it("derives streaming text from ordered non-thinking blocks", () => {
    assert.equal(
      activeRunStreamingText(run()),
      "first answer\ntrailing\nsecond turn",
    );
    assert.equal(activeRunStreamingText(undefined), "");
  });

  it("removes a message by exact liveMessageId", () => {
    const snapshot = run();
    removeActiveRunMessage(snapshot, "msg_2");
    const remaining = snapshot.turns.flatMap((turn) =>
      turn.messages.map((message) => message.liveMessageId),
    );
    assert.deepEqual(remaining.sort(), ["msg_1", "msg_3"]);
  });

  it("drains materialized messages by exact id", () => {
    const snapshot = run();
    drainMaterializedActiveRunMessages(
      snapshot,
      materializedLiveMessagesFromEntries([
        { role: "assistant", liveMessageId: "msg_1" },
      ]),
    );
    const remaining = snapshot.turns.flatMap((turn) =>
      turn.messages.map((message) => message.liveMessageId),
    );
    assert.deepEqual(remaining.sort(), ["msg_2", "msg_3"]);
  });

  it("drains text and draft blocks by turn ordinal watermark on id misses", () => {
    const snapshot = run();
    // The entry materializes msg_2 (ordinal 1 in turn_1) without an id match;
    // the watermark must drain msg_1 and msg_2 — including the draft block —
    // while msg_3 in turn_2 survives.
    drainMaterializedActiveRunMessages(
      snapshot,
      materializedLiveMessagesFromEntries([
        { role: "assistant", turnId: "turn_1", messageOrdinal: 1 },
      ]),
    );
    const remaining = snapshot.turns.flatMap((turn) =>
      turn.messages.map((message) => message.liveMessageId),
    );
    assert.deepEqual(remaining, ["msg_3"]);
  });

  it("ignores non-assistant entries when collecting materialized messages", () => {
    const materialized = materializedLiveMessagesFromEntries([
      { role: "user", turnId: "turn_1", messageOrdinal: 5 },
      { role: "system", liveMessageId: "msg_1" },
    ]);
    assert.equal(materialized.liveMessageIds.size, 0);
    assert.equal(materialized.turnWatermarks.size, 0);
  });

  it("builds stable keys for live blocks and tool slots", () => {
    assert.equal(liveBlockKey("msg_1", "thinking", 2), "live:msg_1:thinking:2");
    assert.equal(toolSlotKey("msg_1", 3), "tool-slot:msg_1:3");
  });
});
