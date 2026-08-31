import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentHarnessEvent } from "@nervekit/harness";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { conversationStream } from "@nervekit/contracts/events";
import { SubagentTranscriptLiveService } from "../../../src/domains/agents/subagent-transcript-live.service.js";
import { StreamLogRegistry } from "../../../src/infrastructure/events/index.js";

const ts = "2026-08-02T00:00:00.000Z";

function child(id: string): AgentRecord {
  return {
    id,
    projectId: "proj_test",
    conversationId: "conv_test",
    rootAgentId: "agent_parent",
    parentAgentId: "agent_parent",
    projectDir: "/workspace",
    mode: "coding",
    permissionLevel: "read_only",
    workspaceScope: { roots: ["/workspace"] },
    status: "running",
    thinkingLevel: "off",
    budget: { depth: 1, maxDepth: 3 },
    createdAt: ts,
    updatedAt: ts,
  } as AgentRecord;
}

function harnessEvent(value: unknown): AgentHarnessEvent {
  return value as AgentHarnessEvent;
}

describe("subagent transcript live service", () => {
  it("streams bounded canonical text with isolated sibling runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-child-live-"));
    try {
      const events = new StreamLogRegistry(root);
      await events.hydrate();
      const live = new SubagentTranscriptLiveService(events);
      const first = child("agent_child_one");
      const second = child("agent_child_two");
      await live.register({
        parentAgentId: "agent_parent",
        child: first,
        runId: "run_child_one",
      });
      await live.register({
        parentAgentId: "agent_parent",
        child: second,
        runId: "run_child_two",
      });

      await live.handleHarnessEvent(
        first.id,
        harnessEvent({ type: "turn_start" }),
      );
      await live.handleHarnessEvent(
        first.id,
        harnessEvent({
          type: "message_start",
          message: { role: "assistant" },
        }),
      );
      await live.handleHarnessEvent(
        first.id,
        harnessEvent({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "partial",
          },
        }),
      );

      const firstSnapshot = live.snapshot(first.id);
      const secondSnapshot = live.snapshot(second.id);
      assert.equal(
        firstSnapshot?.turns[0]?.messages[0]?.blocks[0]?.kind,
        "text",
      );
      assert.equal(
        firstSnapshot?.turns[0]?.messages[0]?.blocks[0]?.text,
        "partial",
      );
      assert.deepEqual(secondSnapshot?.turns, []);

      const stream = await events.readStream(
        conversationStream("conv_test"),
        1,
        100,
      );
      const delta = stream.events.find(
        (event) => event.type === "agent.subagent_transcript.content.delta",
      );
      assert.deepEqual(delta?.data, {
        conversationId: "conv_test",
        projectId: "proj_test",
        parentAgentId: "agent_parent",
        childAgentId: first.id,
        runId: "run_child_one",
        turnId: firstSnapshot?.turns[0]?.turnId,
        liveMessageId: firstSnapshot?.turns[0]?.messages[0]?.liveMessageId,
        contentBlockId:
          firstSnapshot?.turns[0]?.messages[0]?.blocks[0]?.contentBlockId,
        contentIndex: 0,
        kind: "text",
        offset: 0,
        delta: "partial",
      });

      await live.complete(first.id, "aborted", "stopped");
      assert.equal(live.snapshot(first.id), undefined);
      assert.ok(live.snapshot(second.id));
      await live.complete(second.id, "completed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
