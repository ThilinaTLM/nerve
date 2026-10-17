import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompactionOperation } from "@nervekit/contracts/core";
import { reconcileCompactionNotice } from "./compaction-reconciliation";

function operation(
  revision: number,
  patch: Partial<CompactionOperation> = {},
): CompactionOperation {
  return {
    id: "evt_compaction",
    revision,
    reason: "manual",
    status: "running",
    startedAt: "2026-10-17T00:00:00.000Z",
    headEventId: null,
    attempt: 1,
    summaryPreview: "draft",
    ...patch,
  };
}

test("accepts initial notices with an absent or authoritative null operation", () => {
  const incoming = operation(1);
  assert.equal(reconcileCompactionNotice(undefined, incoming), incoming);
  assert.equal(reconcileCompactionNotice(null, incoming), incoming);
});

test("buffered older and duplicate notices cannot regress a recovered snapshot", () => {
  const snapshot = operation(8, {
    status: "completed",
    eventId: "evt_compaction",
  });
  assert.equal(reconcileCompactionNotice(snapshot, operation(7)), snapshot);
  assert.equal(reconcileCompactionNotice(snapshot, operation(8)), snapshot);
});

test("higher revision repair previews replace the previous attempt", () => {
  const current = operation(2, { summaryPreview: "first draft" });
  const repair = operation(3, { attempt: 2, summaryPreview: "replacement" });
  assert.equal(reconcileCompactionNotice(current, repair), repair);
});

test("higher revisions settle running and stopping operations", () => {
  for (const status of ["completed", "failed", "cancelled"] as const) {
    const terminal = operation(5, { status });
    assert.equal(reconcileCompactionNotice(operation(3), terminal), terminal);
    assert.equal(
      reconcileCompactionNotice(operation(4, { status: "stopping" }), terminal),
      terminal,
    );
  }
});

test("revision ordering spans operation identities", () => {
  const previous = operation(9, { status: "completed" });
  const next = operation(10, { id: "evt_next" });
  assert.equal(reconcileCompactionNotice(previous, next), next);
  assert.equal(reconcileCompactionNotice(next, previous), next);
});
