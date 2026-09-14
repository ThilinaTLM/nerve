import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalDeletionCleanupService } from "../../../src/domains/conversations/timeline/canonical-deletion-cleanup.service.js";
import { CanonicalDeletionService } from "../../../src/domains/conversations/timeline/canonical-deletion.service.js";
import { CanonicalTimelinePageService } from "../../../src/domains/conversations/timeline/canonical-timeline-page.service.js";
import { CanonicalManagedArtifactFinalizer } from "../../../src/domains/conversations/timeline/canonical-managed-artifact-finalizer.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

test("INV-DELETE-01 fences dispatch and foreground ownership before cleanup", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-delete-"));
  const databasePath = join(home, "nerve.sqlite");
  let store = new CanonicalStore(databasePath);
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalRunStartService(store).start({
    conversationId: "conv_delete",
    runId: "run_delete",
    agentId: "agent_delete",
    providerIdentity: { provider: "test", model: "test" },
    providerCapability: "stateless_generation",
    prompt: "delete me",
    now: "2026-09-12T00:00:00.000Z",
  });
  const paths = storagePaths(home);
  const artifact = await new CanonicalManagedArtifactFinalizer(paths).finalize({
    artifactId: "artifact_delete_payload",
    ownerKind: "conversation",
    ownerId: "conv_delete",
    relativeLocator: "results/payload.json",
    bytes: new TextEncoder().encode("private payload"),
    mediaType: "application/json",
    semanticRole: "context_source_manifest",
  });
  const identity = await store.readTimelineStateIdentity();
  const activeHead = await store.readTimelineConversationHead("conv_delete");
  assert.ok(identity && activeHead);
  await store.commitConversationCommand({
    namespaceId: identity.namespaceId,
    executionIncarnationId: identity.executionIncarnationId,
    operationKind: "finalize_test_artifact",
    ownerKind: "conversation",
    ownerId: "conv_delete",
    commandId: "command_finalize_test_artifact",
    fingerprintVersion: 1,
    fingerprint: `sha256:${"b".repeat(64)}`,
    expectedHeads: [
      {
        conversationId: "conv_delete",
        revision: activeHead.revision,
        selectionEpoch: activeHead.selectionEpoch,
      },
    ],
    transitions: [],
    finalizedArtifacts: [artifact],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:00.500Z",
  });
  let deletion = new CanonicalDeletionService(store);
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
  await assert.rejects(
    store.appendDurableEvent({
      stream: "conversation:conv_delete",
      intentId: "late-publication",
      eventType: "conversation.entry.created",
      data: { text: "must not publish" },
      occurredAt: "2026-09-12T00:00:01.500Z",
      conversationId: "conv_delete",
    }),
    /deleted_owner:conv_delete/,
  );
  assert.equal(
    (
      await new CanonicalTimelinePageService(
        store,
        new Uint8Array(32).fill(3),
      ).page({ conversationId: "conv_delete" })
    ).kind,
    "deleted_owner",
  );
  const restarted = await new CanonicalRunStartService(store).start({
    conversationId: "conv_delete",
    runId: "run_after_delete",
    agentId: "agent_delete",
    providerIdentity: { provider: "test", model: "test" },
    providerCapability: "stateless_generation",
    prompt: "must fail",
    now: "2026-09-12T00:00:02.000Z",
  });
  assert.equal(restarted.kind, "rejected");
  assert.equal(
    restarted.kind === "rejected" && restarted.outcome.kind,
    "deleted_owner",
  );

  let cleanup = new CanonicalDeletionCleanupService(store, paths);
  assert.equal(
    (await cleanup.advance({ conversationId: "conv_delete", limit: 1 })).phase,
    "settling_execution",
  );
  assert.equal(
    (await cleanup.advance({ conversationId: "conv_delete", limit: 1 })).phase,
    "removing_payloads",
  );
  const abandonedClaims = await store.deletion.claimArtifacts(
    "conv_delete",
    1,
    "2026-09-12T00:00:03.000Z",
  );
  assert.equal(abandonedClaims.length, 1);
  await store.close();
  store = new CanonicalStore(databasePath);
  await store.initialize();
  deletion = new CanonicalDeletionService(store);
  cleanup = new CanonicalDeletionCleanupService(store, paths);
  await cleanup.advance({
    conversationId: "conv_delete",
    limit: 1,
    now: "2026-09-12T00:00:34.000Z",
  });
  await assert.rejects(
    readFile(join(home, artifact.relativeLocator)),
    /ENOENT/,
  );
  let intent = await store.deletion.readIntent("conv_delete");
  for (
    let step = 0;
    intent?.phase === "removing_payloads" && step < 20;
    step += 1
  ) {
    intent = await cleanup.advance({
      conversationId: "conv_delete",
      limit: 1,
      now: `2026-09-12T00:00:${String(step + 3).padStart(2, "0")}.000Z`,
    });
  }
  assert.equal(intent?.phase, "removing_history");
  const deletedHead = await store.readTimelineConversationHead("conv_delete");
  assert.ok(deletedHead?.activeEntryId);
  const ancestry = await store.readTimelineAncestrySegment(
    "conv_delete",
    deletedHead.activeEntryId,
    10,
  );
  assert.equal(ancestry.entries[0]?.inlineContent, undefined);
  assert.deepEqual(ancestry.entries[0]?.provenance, { redacted: true });
  for (let step = 0; intent?.phase !== "finalized" && step < 50; step += 1) {
    intent = await cleanup.advance({
      conversationId: "conv_delete",
      limit: 1,
      now: `2026-09-12T00:01:${String(step).padStart(2, "0")}.000Z`,
    });
  }
  assert.equal(intent?.phase, "finalized");
  assert.equal(
    (await store.readTimelineConversationHead("conv_delete"))?.activeEntryId,
    null,
  );
  const afterFinalization = await deletion.fence(input);
  assert.equal(afterFinalization.kind, "rejected");
  assert.equal(
    afterFinalization.kind === "rejected" && afterFinalization.outcome.kind,
    "deleted_owner",
  );
  const tombstone = await store.deletion.readTombstone("conv_delete");
  assert.ok((tombstone?.commandReservationCount ?? 0) >= 3);
  assert.match(tombstone?.replayEvidenceDigest ?? "", /^sha256:[a-f0-9]{64}$/);
});
