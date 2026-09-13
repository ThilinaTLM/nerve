import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalRunExecutionBoundary } from "../../../src/domains/agents/execution/canonical-run-execution-boundary.js";
import { CanonicalConversationContextService } from "../../../src/domains/conversations/timeline/canonical-conversation-context.service.js";
import { CanonicalConversationCreationService } from "../../../src/domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTimelineService } from "../../../src/domains/conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const now = "2026-09-14T00:00:00.000Z";

test("canonical execution boundary materializes exact messages and closes foreground authority", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-execution-boundary-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalConversationCreationService(store).createEmpty({
    conversationId: "conv_boundary",
    commandId: "create-boundary",
    now,
  });
  const boundary = new CanonicalRunExecutionBoundary(
    new CanonicalRunStartService(store),
    new CanonicalConversationContextService(store),
    new CanonicalRunTimelineService(store),
  );
  const begun = await boundary.begin({
    conversationId: "conv_boundary",
    runId: "run_boundary",
    agentId: "agent_boundary",
    prompt: "inspect",
    conversationCreatedAt: now,
    now: "2026-09-14T00:00:01.000Z",
  });
  assert.equal(begun.kind, "ready");
  if (begun.kind !== "ready") return;
  await begun.value.conversation.appendMessage({
    role: "assistant",
    content: [
      { type: "text", text: "done" },
      {
        type: "toolCall",
        id: "call_boundary",
        name: "read",
        arguments: { path: "README.md" },
      },
    ],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  });
  const flushed = await boundary.flush(begun.value, "2026-09-14T00:00:02.000Z");
  assert.deepEqual(flushed, { kind: "ready", value: 1 });
  assert.deepEqual(
    await boundary.flush(begun.value, "2026-09-14T00:00:03.000Z"),
    { kind: "ready", value: 0 },
  );
  const closed = await boundary.close(begun.value, {
    state: "completed",
    now: "2026-09-14T00:00:04.000Z",
  });
  assert.equal(closed.kind, "ready");
  const head = await store.readTimelineConversationHead("conv_boundary");
  assert.equal(head?.foregroundRunId, null);
  const run = await store.readTimelineRunControl(
    "conv_boundary",
    "run_boundary",
  );
  assert.equal(run?.state, "completed");
  const segment = await store.readTimelineAncestrySegment(
    "conv_boundary",
    head!.activeEntryId!,
    1,
  );
  assert.equal(segment.entries[0]?.kind, "assistant_message");
  assert.equal(
    (
      segment.entries[0]?.inlineContent as {
        exactHarnessMessage?: { stopReason?: string };
      }
    ).exactHarnessMessage?.stopReason,
    "toolUse",
  );
});
