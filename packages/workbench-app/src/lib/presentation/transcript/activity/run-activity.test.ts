import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveRunActivity,
  LONG_WAIT_MS,
  runActivitySignature,
  type PendingWorkItem,
  type RunActivityInput,
  WAITING_SPINNER_RATE,
} from "./run-activity";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const pending: PendingWorkItem[] = [
  { kind: "agent", id: "c1", label: "auth-research" },
  { kind: "command", id: "b1", label: "pnpm test" },
];

function input(overrides: Partial<RunActivityInput> = {}): RunActivityInput {
  return {
    sending: false,
    stopping: false,
    compactionRunning: false,
    nowMs: NOW,
    runSeenAtMs: NOW,
    lastChangeAtMs: NOW,
    ...overrides,
  };
}

describe("waiting activity", () => {
  it("keeps the row mounted with the slow waiting spinner when work is pending", () => {
    const view = deriveRunActivity(
      input({
        pending,
        waitingSeenAtMs: NOW - 4 * 60_000,
      }),
    );
    assert.equal(view.mounted, true);
    assert.equal(view.open, true);
    assert.equal(view.kind, "waiting");
    assert.equal(view.label, "Waiting for");
    assert.equal(view.spinnerRate, WAITING_SPINNER_RATE);
    assert.deepEqual(view.pending, pending);
    assert.equal(view.elapsedLabel, "4:00");
  });

  it("measures the wait from the end of the last run", () => {
    const view = deriveRunActivity(
      input({
        pending,
        waitingSeenAtMs: NOW,
        lastRunOutcome: {
          runId: "r1",
          outcome: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:08:00.000Z",
        } as RunActivityInput["lastRunOutcome"],
      }),
    );
    assert.equal(view.elapsedLabel, "2:00");
  });

  it("returns to the running state when a turn starts", () => {
    const view = deriveRunActivity(input({ pending, sending: true }));
    assert.notEqual(view.kind, "waiting");
    assert.equal(view.pending, undefined);
  });

  it("hides when nothing is pending", () => {
    assert.equal(deriveRunActivity(input({ pending: [] })).mounted, false);
  });
});

describe("retry response availability", () => {
  const activeRun = {
    runId: "r1",
    status: "running",
    turns: [],
    startedAt: new Date(NOW - 60_000).toISOString(),
  } as unknown as RunActivityInput["activeRun"];

  it("is offered only once the wait softens to Still thinking", () => {
    const long = deriveRunActivity(
      input({ sending: true, activeRun, lastChangeAtMs: NOW - LONG_WAIT_MS }),
    );
    assert.equal(long.label, "Still thinking…");
    assert.equal(long.retryEligible, true);
    const short = deriveRunActivity(
      input({ sending: true, activeRun, lastChangeAtMs: NOW - 5_000 }),
    );
    assert.notEqual(short.retryEligible, true);
  });

  it("a response revision changes the signature without any output", () => {
    assert.notEqual(
      runActivitySignature(activeRun, undefined, 0),
      runActivitySignature(activeRun, undefined, 1),
    );
  });

  it("resetting the wait clock keeps the elapsed timer", () => {
    const view = deriveRunActivity(
      input({ sending: true, activeRun, lastChangeAtMs: NOW }),
    );
    assert.notEqual(view.retryEligible, true);
    assert.equal(view.elapsedLabel, "1:00");
  });
});
