import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  LIVE_TOOL_OUTPUT_EVENT_MAX_BYTES,
  type ConversationLiveToolOutputDeltaData,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { ConversationRuntime } from "../../src/domains/runs/runtime/conversation-runtime.js";
import { LiveToolOutputPublisher } from "../../src/domains/tools/execution/live-tool-output-publisher.js";
import { StreamLogRegistry } from "../../src/infrastructure/events/stream-log-registry.js";

function toolCall(): ToolCallRecord {
  return {
    id: "tool_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    runId: "run_test",
    toolName: "bash",
    risk: "command",
    args: {},
    cwd: "/tmp/project",
    status: "running",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
  };
}

function runtime(): ConversationRuntime {
  const runtime = new ConversationRuntime();
  runtime.startRun({
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
  });
  return runtime;
}

describe("LiveToolOutputPublisher", () => {
  it("publishes oversized Unicode output as legal contiguous deltas", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-live-output-"));
    const events = new StreamLogRegistry(home);
    const published: ConversationLiveToolOutputDeltaData[] = [];
    events.subscribeNotify((event) => {
      if (event.type === "conversation.live.tool_output.delta") {
        published.push(event.data as ConversationLiveToolOutputDeltaData);
      }
    });
    const publisher = new LiveToolOutputPublisher(events, runtime());
    const input = `${"x".repeat(70_000)}🙂${"界".repeat(2_000)}`;

    await publisher.publish(toolCall(), {
      kind: "output",
      stream: "stdout",
      chunk: input,
    });
    // Live publication is best-effort; wait for the transient publication
    // queue before asserting on delivered notifications.
    await events.settled();

    assert.equal(published.map((event) => event.delta).join(""), input);
    assert.ok(
      published.every(
        (event) =>
          Buffer.byteLength(event.delta, "utf8") <=
          LIVE_TOOL_OUTPUT_EVENT_MAX_BYTES,
      ),
    );
    let offset = 0;
    for (const event of published) {
      assert.equal(event.offset, offset);
      offset += event.delta.length;
    }
    await assert.rejects(
      readFile(
        join(home, "logs", "events", "conversations", "conv_test.jsonl"),
      ),
      /ENOENT/,
    );
    await events.shutdown();
  });

  it("delegates live publication to best-effort and never rejects", async () => {
    const calls: Array<{ type: string; context: string }> = [];
    const publisher = new LiveToolOutputPublisher(
      {
        publishBestEffort: (type: string, _data: unknown, context: string) =>
          void calls.push({ type, context }),
      } as never,
      runtime(),
    );

    await assert.doesNotReject(
      publisher.publish(toolCall(), {
        kind: "output",
        stream: "stdout",
        chunk: "still supervised",
      }),
    );
    assert.deepEqual(calls, [
      {
        type: "conversation.live.tool_output.delta",
        context: "conversation.live.tool_output.delta",
      },
    ]);
  });
});
