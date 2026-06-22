import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { EventEnvelope } from "@nerve/shared";
import { recoverInterruptedRuns } from "../src/domains/agents/run/interrupted-run-recovery.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { ApplicationLogger } from "../src/logging.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-run-recovery-"));
  roots.push(root);
  return root;
}

function event(
  seq: number,
  type: string,
  data: Record<string, unknown>,
): EventEnvelope {
  return {
    seq,
    id: `evt_${seq}`,
    ts: new Date().toISOString(),
    type,
    durability: "durable",
    data,
  };
}

describe("recoverInterruptedRuns", () => {
  it("fails runs that started but never reached a terminal event", async () => {
    const home = await tempHome();
    const bus = new EventBus(home);
    const logger = new ApplicationLogger({
      dataDir: home,
      mirrorToConsole: false,
    });
    await logger.hydrate();

    const failed: EventEnvelope[] = [];
    bus.subscribe((evt) => {
      if (evt.type === "conversation.run.failed") failed.push(evt);
    });

    const events: EventEnvelope[] = [
      event(1, "conversation.run.started", {
        runId: "run_done",
        agentId: "agent_a",
        projectId: "proj_a",
        conversationId: "conv_a",
      }),
      event(2, "conversation.run.completed", { runId: "run_done" }),
      event(3, "conversation.run.started", {
        runId: "run_stuck",
        agentId: "agent_b",
        projectId: "proj_b",
        conversationId: "conv_b",
      }),
      event(4, "conversation.run.started", {
        runId: "run_suspended",
        agentId: "agent_c",
      }),
      event(5, "conversation.run.suspended", { runId: "run_suspended" }),
    ];

    const recovered = await recoverInterruptedRuns(events, {
      events: bus,
      logger,
    });

    assert.equal(recovered, 1);
    assert.equal(failed.length, 1);
    const data = failed[0]?.data as Record<string, unknown>;
    assert.equal(data.runId, "run_stuck");
    assert.equal(data.conversationId, "conv_b");
    assert.equal(data.aborted, true);
    assert.equal(data.interrupted, true);
  });

  it("does nothing when all runs already reached a terminal state", async () => {
    const home = await tempHome();
    const bus = new EventBus(home);
    const logger = new ApplicationLogger({
      dataDir: home,
      mirrorToConsole: false,
    });
    await logger.hydrate();

    const events: EventEnvelope[] = [
      event(1, "conversation.run.started", { runId: "run_1" }),
      event(2, "conversation.run.failed", { runId: "run_1" }),
    ];

    const recovered = await recoverInterruptedRuns(events, {
      events: bus,
      logger,
    });
    assert.equal(recovered, 0);
  });
});
