import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CanonicalConversationCreationService } from "../../../src/domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalConversationContextService } from "../../../src/domains/conversations/timeline/canonical-conversation-context.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTimelineService } from "../../../src/domains/conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-context-"));
  const sqlitePath = join(home, "nerve.sqlite");
  const store = new CanonicalStore(sqlitePath);
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalConversationCreationService(store).createEmpty({
    conversationId: "conv_context",
    commandId: "create-context",
    now: "2026-09-14T00:00:00.000Z",
  });
  const started = await new CanonicalRunStartService(store).start({
    conversationId: "conv_context",
    runId: "run_context",
    agentId: "agent_context",
    prompt: "first",
    now: "2026-09-14T00:00:01.000Z",
  });
  assert.equal(started.kind, "started");
  await new CanonicalRunTimelineService(store).append({
    conversationId: "conv_context",
    runId: "run_context",
    commandId: "append-context",
    now: "2026-09-14T00:00:02.000Z",
    actor: { kind: "worker" },
    cause: { kind: "provider_response" },
    entries: [
      {
        entryId: "entry_context_answer",
        kind: "assistant_message",
        inlineContent: { text: "second" },
      },
    ],
  });
  return { store, sqlitePath };
}

test("INV-CONTEXT-01 builds provider context only from fenced canonical ancestry", async (t) => {
  const { store, sqlitePath } = await fixture(t);
  const service = new CanonicalConversationContextService(store);
  const result = await service.build({
    conversationId: "conv_context",
    runId: "run_context",
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.deepEqual(
    result.snapshot.entries.map((entry) => entry.kind),
    ["user_message", "assistant_message"],
  );

  const database = new DatabaseSync(sqlitePath);
  database
    .prepare(
      "UPDATE runtime_admission SET dispatch_state = 'disabled' WHERE singleton = 1",
    )
    .run();
  database.close();
  assert.equal(await service.revalidate(result.snapshot), false);
});

test("INV-CONTEXT-01 refuses to truncate canonical ancestry", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(
    new CanonicalConversationContextService(store).build({
      conversationId: "conv_context",
      runId: "run_context",
      maxEntries: 1,
    }),
    /exceeds its bounded limit/,
  );
});
