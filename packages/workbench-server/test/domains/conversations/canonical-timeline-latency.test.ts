import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalTimelineIdentityService } from "../../../src/domains/conversations/timeline/canonical-timeline-identity.service.js";
import { CanonicalTimelinePageService } from "../../../src/domains/conversations/timeline/canonical-timeline-page.service.js";
import { buildAppendTransition } from "../../../src/domains/conversations/timeline/transition-builders.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const BATCHES = 50;
const ENTRIES_PER_BATCH = 40;
const PAGE_SIZE = 50;
const WARMUPS = 10;
const SAMPLES = 100;
const P95_BUDGET_MS = 250;

/** Conservative smoke budget; structural page size is the primary bound. */
test("INV-PAGE-01 INV-PERF-01 bounded history paging stays structurally bounded", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-timeline-latency-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const identity = await new CanonicalTimelineIdentityService(store).resolve();
  let head = {
    schemaVersion: 1 as const,
    conversationId: "conv_latency",
    revision: 0,
    activeEntryId: null as string | null,
    selectionEpoch: 0,
    foregroundRunId: null as string | null,
  };
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const commandId = `latency-seed-${batch}`;
    const fingerprint = `sha256:${batch.toString(16).padStart(64, "0")}`;
    const transition = buildAppendTransition({
      head,
      identity: {
        commandId,
        inputFingerprint: fingerprint,
        actor: { kind: "test" },
        cause: { kind: "latency_seed" },
        committedAt: new Date(Date.UTC(2026, 8, 15, 0, 0, batch)).toISOString(),
      },
      entries: Array.from({ length: ENTRIES_PER_BATCH }, (_, offset) => ({
        entryId: `entry_latency_${batch}_${offset}`,
        kind: "user_message" as const,
        inlineContent: { text: `seed ${batch}:${offset} ${"x".repeat(1024)}` },
      })),
    });
    const outcome = await store.commitConversationCommand({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "latency_seed",
      ownerKind: "conversation",
      ownerId: head.conversationId,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: head.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
          ...(head.revision === 0 ? { createIfMissing: true } : {}),
        },
      ],
      transitions: [transition],
      outcome: {},
      publicationIntents: [],
      now: transition.committedAt,
    });
    assert.equal(outcome.kind, "committed");
    head = transition.resultingHead;
  }

  const pages = new CanonicalTimelinePageService(store, Buffer.alloc(32, 7));
  const durations: number[] = [];
  for (let sample = 0; sample < WARMUPS + SAMPLES; sample += 1) {
    const started = performance.now();
    const outcome = await pages.page({
      conversationId: head.conversationId,
      pageSize: PAGE_SIZE,
    });
    if (sample >= WARMUPS) durations.push(performance.now() - started);
    assert.equal(outcome.kind, "page");
    assert.equal(
      outcome.kind === "page" ? outcome.page.entries.length : 0,
      PAGE_SIZE,
    );
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;
  assert.ok(
    p95 < P95_BUDGET_MS,
    `timeline page p95 ${p95.toFixed(1)}ms exceeded ${P95_BUDGET_MS}ms`,
  );
});
