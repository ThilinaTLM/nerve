import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ArtifactReference } from "@nervekit/contracts/conversations";
import { CanonicalAutoCompactionService } from "../../../src/domains/conversations/timeline/canonical-auto-compaction.service.js";
import { buildAppendTransition } from "../../../src/domains/conversations/timeline/transition-builders.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-09-12T00:00:00.000Z";

test("INV-CONTEXT-01 prepares external evidence before committing and building the next request", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-auto-compact-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const transition = buildAppendTransition({
    head: {
      schemaVersion: 1,
      conversationId: "conv_auto",
      revision: 0,
      activeEntryId: null,
      selectionEpoch: 0,
      foregroundRunId: null,
    },
    identity: {
      commandId: "command_start",
      inputFingerprint: hash,
      actor: { kind: "user" },
      cause: { kind: "prompt" },
      committedAt: now,
      transitionId: "transition_start",
    },
    entries: [
      { entryId: "entry_prompt", kind: "user_message", inlineContent: "hi" },
    ],
    foregroundRunId: "run_auto",
  });
  await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "start",
    ownerKind: "conversation",
    ownerId: "conv_auto",
    commandId: "command_start",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_auto",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [transition],
    runControls: [
      {
        schemaVersion: 1,
        conversationId: "conv_auto",
        runId: "run_auto",
        generation: 1,
        boundSelectionEpoch: 0,
        continuationEntryId: "entry_prompt",
        checkpointId: null,
        waitGroupId: null,
        providerPhaseId: null,
        state: "running",
        foregroundOwned: true,
        revision: 1,
      },
    ],
    outcome: {},
    publicationIntents: [],
    now,
  });

  const order: string[] = [];
  const service = new CanonicalAutoCompactionService(store, {
    async finalize(input): Promise<ArtifactReference> {
      order.push(`artifact:${input.semanticRole}`);
      return {
        artifactId: input.artifactId,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        relativeLocator: input.relativeLocator,
        digest: `sha256:${createHash("sha256").update(input.bytes).digest("hex")}`,
        byteLength: input.bytes.byteLength,
        mediaType: input.mediaType,
        semanticRole: input.semanticRole,
        availability: "available",
      };
    },
  });
  const result = await service.compactThenPrepareProviderPhase({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    conversationId: "conv_auto",
    runId: "run_auto",
    policyVersion: 1,
    providerAdapterVersion: "test-v1",
    providerIdentity: { provider: "test" },
    providerCapability: "stateless_generation",
    recipeVersion: 1,
    preparedAt: "2026-09-12T00:00:01.000Z",
    async prepareSummary(entries) {
      order.push("summary");
      assert.deepEqual(
        entries.map((entry) => entry.entryId),
        ["entry_prompt"],
      );
      return { summary: "summary", anchorEntryId: "entry_prompt" };
    },
    async prepareProviderPhase(snapshot) {
      order.push("provider");
      assert.equal(
        (await store.readTimelineConversationHead("conv_auto"))?.revision,
        snapshot.revision,
      );
      return { requestSourceEntryId: snapshot.headEntryId };
    },
  });
  assert.equal(result.kind, "ready");
  assert.deepEqual(order, [
    "summary",
    "artifact:context_source_manifest",
    "provider",
  ]);
  assert.equal(
    result.kind === "ready" && result.preparedPhase.requestSourceEntryId,
    result.kind === "ready" ? result.snapshot.headEntryId : undefined,
  );
  const persistedRun = await store.readTimelineRunControl(
    "conv_auto",
    "run_auto",
  );
  assert.equal(persistedRun?.revision, 3);
  assert.match(persistedRun?.providerPhaseId ?? "", /^provider_phase_/);
  assert.equal(
    result.kind === "ready" ? result.snapshot.runRevision : undefined,
    persistedRun?.revision,
  );
});
