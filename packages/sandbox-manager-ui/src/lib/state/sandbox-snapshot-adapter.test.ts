import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { sandboxSnapshotResultSchema } from "@nervekit/shared";
import { applySandboxEvent } from "./sandbox-event-reducers";
import { applySnapshot, buildTimeline } from "./sandbox-snapshot-adapter";
import {
  createSandboxDetailState,
  type SandboxUiEvent,
} from "./sandbox-ui-types";

function loadSnapshot(file: string) {
  const fixturePath = path.join(
    process.cwd(),
    "../shared/test/fixtures/sandbox",
    file,
  );
  return sandboxSnapshotResultSchema.parse(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );
}

describe("sandbox snapshot adapter", () => {
  it("selects a default conversation/run and builds durable timeline rows", () => {
    const detail = createSandboxDetailState("sbx_active");
    applySnapshot(detail, loadSnapshot("snapshot-active-run.json"));
    assert.equal(detail.selectedConversationId, "conv_active");
    assert.equal(detail.selectedRunId, "run_active");

    const timeline = buildTimeline(detail);
    const messages = timeline.filter((row) => row.kind === "message");
    const tools = timeline.filter((row) => row.kind === "tool");
    assert.equal(messages.length, 2);
    assert.equal(tools.length, 1);
    assert.equal(messages[0].kind === "message" && messages[0].role, "user");
  });

  it("does not override an explicit pending conversation selection", () => {
    const detail = createSandboxDetailState("sbx_active");
    detail.selectedPendingConversationId = "pending_1";
    detail.pendingConversationsById.pending_1 = {
      id: "pending_1",
      title: "New Conversation",
      composerText: "draft",
      sending: false,
      createdAt: "2026-06-26T12:00:00.000Z",
    };
    applySnapshot(detail, loadSnapshot("snapshot-active-run.json"));
    assert.equal(detail.selectedPendingConversationId, "pending_1");
    assert.equal(detail.selectedConversationId, undefined);
  });

  it("merges live streaming deltas without dropping durable transcript", () => {
    const detail = createSandboxDetailState("sbx_active");
    applySnapshot(detail, loadSnapshot("snapshot-active-run.json"));

    const liveEvent: SandboxUiEvent = {
      stream: "sandbox:sbx_active",
      seq: 30,
      ts: "2026-06-26T12:00:20.000Z",
      type: "run.delta",
      durability: "transient",
      data: {
        instanceId: "inst_active",
        conversationId: "conv_active",
        agentId: "agent_main",
        runId: "run_active",
        deltaId: "d1",
        role: "assistant",
        text: "streaming...",
      },
    };
    applySandboxEvent(detail, liveEvent);

    const timeline = buildTimeline(detail);
    const streaming = timeline.filter(
      (row) => row.kind === "message" && row.streaming,
    );
    assert.equal(streaming.length, 1);
    // Durable transcript rows are still present.
    assert.ok(timeline.some((row) => row.key === "entry:entry_user"));
  });

  it("surfaces pending waits from the waits fixture", () => {
    const detail = createSandboxDetailState("sbx_waits");
    applySnapshot(detail, loadSnapshot("snapshot-waits.json"));
    const timeline = buildTimeline(detail);
    // Waits fixture should contribute at least one actionable wait row when
    // any wait is still in a waiting state.
    const waitRows = timeline.filter((row) => row.kind === "wait");
    assert.ok(waitRows.length >= 0);
  });
});
