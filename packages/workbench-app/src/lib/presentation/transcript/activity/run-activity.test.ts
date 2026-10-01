import type { ConversationActiveRunSnapshot } from "@nervekit/contracts/conversations";
import type { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem } from "../../state/timeline";
import {
  CLOSE_MS,
  DONE_LINGER_MS,
  IDLE_STREAM_MS,
  LONG_WAIT_MS,
  MIN_VISIBLE_MS,
  SHOW_DELAY_MS,
  deriveRunActivity,
  runActivitySignature,
  stabilizeRunActivity,
  type RunActivityInput,
} from "./run-activity";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function run(
  overrides: Partial<ConversationActiveRunSnapshot> = {},
): ConversationActiveRunSnapshot {
  return {
    runId: "run_1",
    agentId: "agent_1",
    projectId: "proj_1",
    conversationId: "conv_1",
    status: "running",
    startedAt: iso(T0),
    turns: [{ turnId: "turn_1", ordinal: 0, messages: [] }],
    toolOutputsByToolCallId: {},
    queuedPrompts: [],
    ...overrides,
  };
}

function message(
  role: "user" | "assistant",
  extra: { live?: boolean; done?: boolean } = {},
): TimelineItem {
  return {
    kind: "message",
    key: `msg-${role}`,
    item: { role, text: "hello", ...extra },
  };
}

function tool(status: ToolCallTranscriptRecord["status"]): TimelineItem {
  return {
    kind: "tool",
    key: "tool-1",
    toolCall: { id: "tool_1", status } as ToolCallTranscriptRecord,
  };
}

/** Running input observed well past the show delay with a stale tail. */
function input(overrides: Partial<RunActivityInput> = {}): RunActivityInput {
  const nowMs = T0 + 5_000;
  return {
    sending: true,
    activeRun: run(),
    stopping: false,
    compactionRunning: false,
    tail: message("user"),
    nowMs,
    runSeenAtMs: T0,
    lastChangeAtMs: nowMs - 1_000,
    ...overrides,
  };
}

describe("deriveRunActivity", () => {
  it("stays collapsed until the show delay so fast replies never flash", () => {
    const view = deriveRunActivity(
      input({ nowMs: T0 + SHOW_DELAY_MS - 1, lastChangeAtMs: T0 }),
    );
    assert.equal(view.mounted, true);
    assert.equal(view.open, false);
    assert.equal(view.label, undefined);
  });

  it("labels waiting phases from run and tail state", () => {
    assert.equal(deriveRunActivity(input()).label, "Thinking…");
    assert.equal(
      deriveRunActivity(input({ tail: tool("completed") })).label,
      "Reading results…",
    );
    assert.equal(
      deriveRunActivity(input({ activeRun: run({ turns: [] }) })).label,
      "Starting…",
    );
    assert.equal(
      deriveRunActivity(input({ activeRun: undefined })).label,
      "Starting…",
    );
  });

  it("stays quiet while output is visibly progressing", () => {
    const streaming = deriveRunActivity(
      input({
        tail: message("assistant", { live: true }),
        lastChangeAtMs: T0 + 5_000 - 100,
      }),
    );
    assert.equal(streaming.kind, "quiet");
    assert.equal(streaming.label, undefined);
    const running = deriveRunActivity(input({ tail: tool("running") }));
    assert.equal(running.kind, "quiet");
  });

  it("lets finished output settle so run completion never flashes a label", () => {
    const settling = input({
      tail: message("assistant", { done: true }),
      lastChangeAtMs: T0 + 5_000 - IDLE_STREAM_MS + 1,
    });
    assert.equal(deriveRunActivity(settling).kind, "quiet");
    assert.equal(
      deriveRunActivity({
        ...settling,
        lastChangeAtMs: T0 + 5_000 - IDLE_STREAM_MS,
      }).label,
      "Thinking…",
    );
  });

  it("reads a stalled stream as thinking after the idle window", () => {
    const view = deriveRunActivity(
      input({
        tail: message("assistant", { live: true }),
        lastChangeAtMs: T0 + 5_000 - IDLE_STREAM_MS,
      }),
    );
    assert.equal(view.kind, "active");
    assert.equal(view.label, "Thinking…");
  });

  it("softens long waits and slows the spinner", () => {
    const view = deriveRunActivity(
      input({ nowMs: T0 + 30_000, lastChangeAtMs: T0 + 30_000 - LONG_WAIT_MS }),
    );
    assert.equal(view.label, "Still thinking…");
    assert.equal(view.spinnerRate, 0.5);
  });

  it("shows a quiet waiting label without a clock while the run awaits the user", () => {
    const view = deriveRunActivity(
      input({ tail: tool("waiting"), nowMs: T0 + 60 * 60_000 }),
    );
    assert.equal(view.label, "Waiting for you");
    assert.equal(view.elapsedLabel, undefined);
    assert.equal(view.spinnerRate, 0);
    assert.equal(
      deriveRunActivity(input({ activeRun: run({ status: "waiting" }) })).kind,
      "quiet",
    );
  });

  it("owns the retry countdown", () => {
    const view = deriveRunActivity(
      input({
        activeRun: run({
          status: "retrying",
          retry: {
            attempt: 2,
            maxRetries: 3,
            delayMs: 4_000,
            retryAt: iso(T0 + 8_000),
          },
        }),
        nowMs: T0 + 5_000,
      }),
    );
    assert.equal(view.kind, "retry");
    assert.equal(view.tone, "warning");
    assert.equal(view.labelKey, "retry:2");
    assert.equal(view.label, "Provider error · retrying in 3s (2/3)");
    assert.equal(view.countdownFraction, 0.75);
  });

  it("prioritises stopping over every other phase", () => {
    const view = deriveRunActivity(
      input({ activeRun: run({ status: "aborting" }), tail: tool("running") }),
    );
    assert.equal(view.label, "Stopping…");
    assert.equal(
      deriveRunActivity(input({ stopping: true })).label,
      "Stopping…",
    );
  });

  it("measures elapsed time from the run start, not from mount", () => {
    const view = deriveRunActivity(
      input({ nowMs: T0 + 65_000, runSeenAtMs: T0 + 60_000 }),
    );
    assert.equal(view.elapsedLabel, "1:05");
    assert.equal(
      deriveRunActivity(input({ nowMs: T0 + 2_000 })).elapsedLabel,
      undefined,
    );
  });

  it("hides during compaction and continuable interruptions", () => {
    assert.equal(
      deriveRunActivity(input({ compactionRunning: true })).mounted,
      false,
    );
    assert.equal(
      deriveRunActivity(
        input({ sending: false, activeRun: run({ status: "interrupted" }) }),
      ).mounted,
      false,
    );
  });

  describe("after the run", () => {
    const ended = (
      outcome: "completed" | "stopped" | "failed",
      durationMs: number,
      sinceMs: number,
    ) =>
      deriveRunActivity(
        input({
          sending: false,
          activeRun: undefined,
          lastRunOutcome: {
            runId: "run_1",
            outcome,
            startedAt: iso(T0),
            endedAt: iso(T0 + durationMs),
          },
          nowMs: T0 + durationMs + sinceMs,
          outcomeSeenAtMs: T0 + durationMs,
        }),
      );

    it("lingers with a done cue, then collapses before unmounting", () => {
      const done = ended("completed", 17_000, 100);
      assert.equal(done.kind, "done");
      assert.equal(done.label, "Done in 0:17");
      assert.equal(done.open, true);
      const closing = ended("completed", 17_000, DONE_LINGER_MS + 10);
      assert.equal(closing.mounted, true);
      assert.equal(closing.open, false);
      assert.equal(
        ended("completed", 17_000, DONE_LINGER_MS + CLOSE_MS).mounted,
        false,
      );
    });

    it("finishes short runs silently", () => {
      const view = ended("completed", 1_200, 50);
      assert.equal(view.open, false);
      assert.equal(view.label, undefined);
    });

    it("reports stopped runs regardless of length", () => {
      assert.equal(ended("stopped", 1_200, 50).label, "Stopped after 0:01");
    });

    it("leaves failures to the transcript notice", () => {
      assert.equal(ended("failed", 17_000, 50).open, false);
    });

    it("does not replay a cue for an outcome observed before mount", () => {
      const view = deriveRunActivity(
        input({
          sending: false,
          activeRun: undefined,
          lastRunOutcome: {
            runId: "run_1",
            outcome: "completed",
            startedAt: iso(T0),
            endedAt: iso(T0 + 10_000),
          },
          outcomeSeenAtMs: undefined,
        }),
      );
      assert.equal(view.mounted, false);
    });
  });
});

describe("runActivitySignature", () => {
  it("changes when streamed text grows or tool status changes", () => {
    const a = runActivitySignature(run(), message("assistant", { live: true }));
    const b = runActivitySignature(run(), {
      kind: "message",
      key: "msg-assistant",
      item: { role: "assistant", text: "hello!", live: true },
    });
    assert.notEqual(a, b);
    assert.notEqual(
      runActivitySignature(run(), tool("running")),
      runActivitySignature(run(), tool("completed")),
    );
  });
});

describe("stabilizeRunActivity", () => {
  const active = deriveRunActivity(input());
  const quiet = deriveRunActivity(input({ tail: tool("running") }));

  it("holds an active label for the minimum visible time", () => {
    const shown = stabilizeRunActivity(undefined, active, 1_000);
    const held = stabilizeRunActivity(shown, quiet, 1_000 + MIN_VISIBLE_MS - 1);
    assert.equal(held.view.label, "Thinking…");
    const released = stabilizeRunActivity(held, quiet, 1_000 + MIN_VISIBLE_MS);
    assert.equal(released.view.kind, "quiet");
  });

  it("never holds a label past the end of the run", () => {
    const shown = stabilizeRunActivity(undefined, active, 1_000);
    const next = stabilizeRunActivity(
      shown,
      { ...quiet, mounted: false },
      1_010,
    );
    assert.equal(next.view.mounted, false);
  });
});
