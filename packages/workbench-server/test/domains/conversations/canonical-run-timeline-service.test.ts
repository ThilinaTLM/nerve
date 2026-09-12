import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTimelineService } from "../../../src/domains/conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-HEAD-01 advances and releases one foreground continuation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-run-timeline-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalRunStartService(store).start({
    conversationId: "conv_run",
    runId: "run_one",
    agentId: "agent_one",
    prompt: "hello",
    now: "2026-09-12T00:00:00.000Z",
  });
  const timeline = new CanonicalRunTimelineService(store);
  const append = await timeline.append({
    conversationId: "conv_run",
    runId: "run_one",
    commandId: "append-assistant",
    now: "2026-09-12T00:00:01.000Z",
    actor: { kind: "agent" },
    cause: { kind: "provider_response" },
    entries: [{ kind: "assistant_message", inlineContent: { text: "done" } }],
  });
  assert.equal(append.kind, "committed");
  const closeInput = {
    conversationId: "conv_run",
    runId: "run_one",
    commandId: "close-run",
    now: "2026-09-12T00:00:02.000Z",
    actor: { kind: "scheduler" },
    cause: { kind: "settled" },
    state: "completed" as const,
  };
  const closed = await timeline.close(closeInput);
  assert.equal(closed.kind, "committed");
  const replay = await timeline.close(closeInput);
  assert.equal(replay.kind, "receipt_replay");
  const head = await store.readTimelineConversationHead("conv_run");
  assert.equal(head?.revision, 3);
  assert.equal(head?.foregroundRunId, null);
  assert.equal(
    (await store.readTimelineRunControl("conv_run", "run_one"))
      ?.foregroundOwned,
    false,
  );
});
