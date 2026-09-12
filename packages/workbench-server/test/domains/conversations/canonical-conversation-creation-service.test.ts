import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalConversationCreationService } from "../../../src/domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const now = "2026-09-13T00:00:00.000Z";

test("INV-AUTH-01 imports history through one canonical creation command", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-create-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const creation = new CanonicalConversationCreationService(store);
  const input = {
    conversationId: "conv_imported",
    commandId: "command_import",
    now,
    entries: [
      {
        entryId: "entry_imported_user",
        kind: "user_message" as const,
        inlineContent: { text: "question" },
        artifacts: [],
        provenance: {},
      },
      {
        entryId: "entry_imported_assistant",
        kind: "assistant_message" as const,
        inlineContent: { text: "answer" },
        artifacts: [],
        provenance: {},
      },
    ],
  };
  const imported = await creation.importHistory(input);
  assert.equal(imported.kind, "committed");
  assert.equal(imported.head.activeEntryId, "entry_imported_assistant");
  assert.equal((await creation.importHistory(input)).kind, "receipt_replay");
  const ancestry = await store.readTimelineFixedAncestryPage(
    "conv_imported",
    "entry_imported_assistant",
    undefined,
    10,
  );
  assert.deepEqual(
    ancestry.entries.map((entry) => entry.entryId),
    ["entry_imported_user", "entry_imported_assistant"],
  );
  const conflicting = await creation.importHistory({
    ...input,
    entries: [{ ...input.entries[0]!, inlineContent: { text: "changed" } }],
  });
  assert.equal(conflicting.kind, "rejected");
  assert.equal(
    conflicting.kind === "rejected" && conflicting.outcome.kind,
    "fingerprint_mismatch",
  );
});

test("INV-ID-01 creates an empty canonical conversation durably", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-empty-"));
  const path = join(home, "nerve.sqlite");
  const store = new CanonicalStore(path);
  await store.initialize();
  const creation = new CanonicalConversationCreationService(store);
  const result = await creation.createEmpty({
    conversationId: "conv_empty",
    commandId: "command_empty",
    now,
  });
  assert.equal(result.kind, "committed");
  await store.close();
  const reopened = new CanonicalStore(path);
  await reopened.initialize();
  t.after(async () => {
    await reopened.close();
    await rm(home, { recursive: true, force: true });
  });
  assert.deepEqual(await reopened.readTimelineConversationHead("conv_empty"), {
    schemaVersion: 1,
    conversationId: "conv_empty",
    revision: 0,
    activeEntryId: null,
    selectionEpoch: 0,
    foregroundRunId: null,
  });
});
