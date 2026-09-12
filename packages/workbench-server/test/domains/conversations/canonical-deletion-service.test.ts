import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalDeletionService } from "../../../src/domains/conversations/timeline/canonical-deletion.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-DELETE-01 fences dispatch and foreground ownership before cleanup", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-delete-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalRunStartService(store).start({
    conversationId: "conv_delete",
    runId: "run_delete",
    agentId: "agent_delete",
    prompt: "delete me",
    now: "2026-09-12T00:00:00.000Z",
  });
  const deletion = new CanonicalDeletionService(store);
  const input = {
    conversationId: "conv_delete",
    commandId: "delete-command",
    uncertaintyAcknowledged: false,
    now: "2026-09-12T00:00:01.000Z",
  };
  const fenced = await deletion.fence(input);
  assert.equal(fenced.kind, "committed");
  assert.equal(
    (await store.readTimelineRunControl("conv_delete", "run_delete"))?.state,
    "deletion_fenced",
  );
  assert.equal(
    (await store.readTimelineConversationHead("conv_delete"))?.foregroundRunId,
    null,
  );
  assert.equal((await deletion.fence(input)).kind, "receipt_replay");
  const restarted = await new CanonicalRunStartService(store).start({
    conversationId: "conv_delete",
    runId: "run_after_delete",
    agentId: "agent_delete",
    prompt: "must fail",
    now: "2026-09-12T00:00:02.000Z",
  });
  assert.equal(restarted.kind, "rejected");
  assert.equal(
    restarted.kind === "rejected" && restarted.outcome.kind,
    "deleted_owner",
  );
});
