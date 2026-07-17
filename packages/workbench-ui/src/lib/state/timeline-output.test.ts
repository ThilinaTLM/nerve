import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasActiveTurnTimelineOutput,
  hasTurnTimelineOutput,
  latestActiveTurn,
} from "./timeline-output";
import { buildConversationTimeline } from "./timeline";
import {
  activeRun,
  draftBlock,
  liveMessage,
  runTurn,
  textBlock,
  toolCall,
} from "./timeline.fixtures";
import type { ConversationLiveMessageSnapshot } from "@nervekit/contracts";
import type { TranscriptItem } from "./transcript-types";

const runId = "run_active";
const firstTurnId = "turn_first";
const secondTurnId = "turn_second";

function runWithSecondTurn(
  secondTurnMessages: ConversationLiveMessageSnapshot[] = [],
  transcript: TranscriptItem[] = [],
) {
  const run = activeRun({
    runId,
    turns: [
      runTurn(firstTurnId, 0, [
        liveMessage("message_first", 0, [
          textBlock("text", 0, "Earlier output", true),
        ]),
      ]),
      runTurn(secondTurnId, 1, secondTurnMessages),
    ],
  });
  return {
    run,
    timeline: buildConversationTimeline(transcript, [], run),
  };
}

describe("active turn timeline output", () => {
  it("treats a missing or empty latest turn as pre-output", () => {
    const noTurns = activeRun({ runId });
    const { run, timeline } = runWithSecondTurn();

    assert.equal(latestActiveTurn(noTurns), undefined);
    assert.equal(hasActiveTurnTimelineOutput([], noTurns), false);
    assert.equal(latestActiveTurn(run)?.turnId, secondTurnId);
    assert.equal(hasActiveTurnTimelineOutput(timeline, run), false);
    assert.equal(
      hasTurnTimelineOutput(timeline, runId, firstTurnId),
      true,
      "prior-turn output remains identifiable but must not satisfy the latest turn",
    );
  });

  it("recognizes live text and thinking from the latest turn", () => {
    for (const kind of ["text", "thinking"] as const) {
      const { run, timeline } = runWithSecondTurn([
        liveMessage("message_second", 0, [
          textBlock(kind, 0, "Streaming output"),
        ]),
      ]);

      assert.equal(hasActiveTurnTimelineOutput(timeline, run), true);
    }
  });

  it("recognizes durable latest-turn output after live materialization", () => {
    const { run, timeline } = runWithSecondTurn(
      [],
      [
        {
          id: "entry_first",
          runId,
          turnId: firstTurnId,
          role: "assistant",
          text: "Earlier durable output",
        },
        {
          id: "entry_second",
          runId,
          turnId: secondTurnId,
          role: "assistant",
          text: "Final durable output",
        },
      ],
    );

    assert.equal(hasActiveTurnTimelineOutput(timeline, run), true);
  });

  it("recognizes latest-turn tool drafts and materialized tool calls", () => {
    const draftRun = activeRun({
      runId,
      turns: [
        runTurn(secondTurnId, 1, [
          liveMessage("message_second", 0, [draftBlock(0)]),
        ]),
      ],
    });
    const draftTimeline = buildConversationTimeline([], [], draftRun);
    const toolRun = activeRun({
      runId,
      turns: [runTurn(secondTurnId, 1, [])],
    });
    const toolTimeline = buildConversationTimeline(
      [],
      [
        toolCall("tool_active", "2026-01-01T00:00:00.000Z", "bash", undefined, {
          runId,
          turnId: secondTurnId,
          status: "completed",
        }),
      ],
      toolRun,
    );

    assert.equal(hasActiveTurnTimelineOutput(draftTimeline, draftRun), true);
    assert.equal(hasActiveTurnTimelineOutput(toolTimeline, toolRun), true);
  });

  it("ignores current-run user input and output from other runs or turns", () => {
    const { run, timeline } = runWithSecondTurn(
      [],
      [
        {
          id: "entry_user",
          runId,
          turnId: secondTurnId,
          role: "user",
          text: "Follow up",
        },
        {
          id: "entry_other_turn",
          runId,
          turnId: firstTurnId,
          role: "assistant",
          text: "Earlier answer",
        },
        {
          id: "entry_other_run",
          runId: "run_other",
          turnId: secondTurnId,
          role: "assistant",
          text: "Unrelated answer",
        },
      ],
    );

    assert.equal(hasActiveTurnTimelineOutput(timeline, run), false);
  });
});
