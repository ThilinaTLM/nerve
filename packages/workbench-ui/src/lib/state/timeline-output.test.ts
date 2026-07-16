import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasRunTimelineOutput } from "./timeline-output";
import { buildConversationTimeline } from "./timeline";
import {
  activeRun,
  liveMessage,
  runTurn,
  textBlock,
  toolCall,
} from "./timeline.fixtures";
import type { TranscriptItem } from "./transcript-types";

const runId = "run_active";

function runningTimeline(transcript: TranscriptItem[] = []) {
  return buildConversationTimeline(transcript, [], activeRun({ runId }));
}

describe("hasRunTimelineOutput", () => {
  it("does not treat missing run state or the run's user prompt as output", () => {
    const userOnly = runningTimeline([
      { id: "entry_user", runId, role: "user", text: "Start" },
    ]);

    assert.equal(hasRunTimelineOutput(userOnly, undefined), false);
    assert.equal(hasRunTimelineOutput(userOnly, runId), false);
  });

  it("recognizes live and durable assistant output from the active run", () => {
    const live = buildConversationTimeline(
      [],
      [],
      activeRun({
        runId,
        turns: [
          runTurn("turn_active", 0, [
            liveMessage("message_active", 0, [
              textBlock("text", 0, "Streaming answer"),
            ]),
          ]),
        ],
      }),
    );
    const durable = runningTimeline([
      {
        id: "entry_assistant",
        runId,
        role: "assistant",
        text: "Durable answer",
      },
    ]);

    assert.equal(live[0]?.kind, "message");
    if (live[0]?.kind === "message") {
      assert.equal(live[0].item.runId, runId);
    }
    assert.equal(hasRunTimelineOutput(live, runId), true);
    assert.equal(hasRunTimelineOutput(durable, runId), true);
  });

  it("ignores output from an older run", () => {
    const timeline = runningTimeline([
      {
        id: "entry_old_assistant",
        runId: "run_old",
        role: "assistant",
        text: "Earlier answer",
      },
    ]);

    assert.equal(hasRunTimelineOutput(timeline, runId), false);
  });

  it("recognizes current-run tool activity and fallback tool errors", () => {
    const toolTimeline = buildConversationTimeline(
      [],
      [
        toolCall("tool_active", "2026-01-01T00:00:00.000Z", "bash", undefined, {
          runId,
          status: "completed",
        }),
      ],
      activeRun({ runId }),
    );
    const errorTimeline = runningTimeline([
      {
        id: "entry_tool_error",
        runId,
        role: "system",
        text: "Tool failed validation",
        toolCallId: "missing_tool",
        toolName: "edit",
        isToolError: true,
      },
    ]);

    assert.equal(hasRunTimelineOutput(toolTimeline, runId), true);
    assert.equal(errorTimeline[0]?.kind, "tool_result_error");
    assert.equal(hasRunTimelineOutput(errorTimeline, runId), true);
  });
});
