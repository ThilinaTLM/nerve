import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger, type StructuredLogRecord } from "@nervekit/contracts";
import { HarnessEventBridge } from "../src/agent/harness-event-bridge.js";

type Sub = (event: unknown) => Promise<void> | void;

function fakeHarness() {
  const subs: Sub[] = [];
  return {
    subscribe: (cb: Sub) => {
      subs.push(cb);
      return () => undefined;
    },
    emit: async (event: unknown) => {
      for (const cb of subs) await cb(event);
    },
  };
}

function captureBridge() {
  const records: StructuredLogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: () => undefined,
    onRecord: (record) => records.push(record),
  });
  // No events/runs/artifacts stores: handle() short-circuits persistence and
  // only exercises the in-memory runtime + logging.
  const bridge = new HarnessEventBridge(
    undefined,
    undefined,
    {},
    {},
    undefined,
    logger,
  );
  return { bridge, records };
}

const context = {
  conversationId: "conv_1",
  agentId: "agent_main",
  runId: "run_1",
  executionId: "exec_1",
};

describe("HarnessEventBridge logging", () => {
  it("logs tool start/completed with durationMs and correlation ids", async () => {
    const { bridge, records } = captureBridge();
    const harness = fakeHarness();
    bridge.attach(harness as never, context);

    await harness.emit({
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "bash",
      args: { command: "echo hi", password: "hunter2" },
    });
    await harness.emit({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "bash",
      result: "SENSITIVE-OUTPUT",
      isError: false,
    });

    const started = records.find((r) => r.message === "tool started");
    const completed = records.find((r) => r.message === "tool completed");
    assert.ok(started, "expected a tool started record");
    assert.ok(completed, "expected a tool completed record");
    assert.equal(started?.toolName, "bash");
    assert.equal(started?.conversationId, "conv_1");
    assert.equal(started?.runId, "run_1");
    assert.equal(completed?.toolName, "bash");
    assert.equal(typeof completed?.durationMs, "number");

    // Success results and raw args must never appear in logs.
    const dump = JSON.stringify(records);
    assert.doesNotMatch(dump, /SENSITIVE-OUTPUT/);
    assert.doesNotMatch(dump, /hunter2/);
  });

  it("logs tool failures at warn with the bounded error", async () => {
    const { bridge, records } = captureBridge();
    const harness = fakeHarness();
    bridge.attach(harness as never, context);

    await harness.emit({
      type: "tool_execution_start",
      toolCallId: "call_2",
      toolName: "python",
      args: {},
    });
    await harness.emit({
      type: "tool_execution_end",
      toolCallId: "call_2",
      toolName: "python",
      result: "boom failed",
      isError: true,
    });

    const failed = records.find((r) => r.message === "tool failed");
    assert.ok(failed, "expected a tool failed record");
    assert.equal(failed?.level, "warn");
    assert.equal(failed?.toolName, "python");
    assert.match(
      String((failed?.err as { message?: string })?.message),
      /boom failed/,
    );
  });

  it("logs bridge run lifecycle transitions", async () => {
    const { bridge, records } = captureBridge();
    await bridge.startRun(context);
    await bridge.completeRun(context);
    await bridge.failRun(context, { message: "nope" }, false);

    const messages = records.map((r) => r.message);
    assert.ok(messages.includes("bridge run started"));
    assert.ok(messages.includes("bridge run completed"));
    const failed = records.find((r) => r.message === "bridge run failed");
    assert.ok(failed);
    assert.equal(failed?.level, "warn");
    assert.equal(failed?.conversationId, "conv_1");
  });
});
