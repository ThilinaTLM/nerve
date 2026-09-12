import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalNavigationService } from "../../../src/domains/conversations/timeline/canonical-navigation.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTimelineService } from "../../../src/domains/conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-HEAD-01 navigation fences ownership and never revives it", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-navigation-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const started = await new CanonicalRunStartService(store).start({
    conversationId: "conv_nav",
    runId: "run_nav",
    agentId: "agent_nav",
    prompt: "hello",
    now: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(started.kind, "started");
  const originalHead =
    started.kind === "started" ? started.run.continuationEntryId : null;
  const appended = await new CanonicalRunTimelineService(store).append({
    conversationId: "conv_nav",
    runId: "run_nav",
    commandId: "append-nav",
    now: "2026-09-12T00:00:01.000Z",
    actor: { kind: "agent" },
    cause: { kind: "response" },
    entries: [{ kind: "assistant_message", inlineContent: "response" }],
  });
  const responseHead =
    appended.kind === "committed" ? appended.run.continuationEntryId : null;
  const navigation = new CanonicalNavigationService(store);
  const away = await navigation.select({
    conversationId: "conv_nav",
    targetEntryId: originalHead,
    commandId: "navigate-away",
    now: "2026-09-12T00:00:02.000Z",
    actor: { kind: "user" },
    cause: { kind: "navigate" },
  });
  assert.equal(away.kind, "committed");
  assert.equal(away.kind === "committed" && away.head.selectionEpoch, 1);
  const back = await navigation.select({
    conversationId: "conv_nav",
    targetEntryId: responseHead,
    commandId: "navigate-back",
    now: "2026-09-12T00:00:03.000Z",
    actor: { kind: "user" },
    cause: { kind: "navigate" },
  });
  assert.equal(back.kind, "committed");
  assert.equal(back.kind === "committed" && back.head.selectionEpoch, 2);
  assert.equal(back.kind === "committed" && back.head.foregroundRunId, null);
  assert.equal(
    (await store.readTimelineRunControl("conv_nav", "run_nav"))?.state,
    "superseded",
  );
  const same = await navigation.select({
    conversationId: "conv_nav",
    targetEntryId: responseHead,
    commandId: "navigate-same",
    now: "2026-09-12T00:00:04.000Z",
    actor: { kind: "user" },
    cause: { kind: "navigate" },
  });
  assert.equal(same.kind, "committed");
  assert.equal(same.kind === "committed" && same.changed, false);
  assert.equal(
    (await store.readTimelineConversationHead("conv_nav"))?.revision,
    4,
  );
});
