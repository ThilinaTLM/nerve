import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineViewOutcome } from "@nervekit/contracts/conversations";
import { reconcileTimelineOutcome } from "./timeline-reconciliation";

describe("canonical timeline reconciliation", () => {
  const cases: Array<[TimelineViewOutcome, string]> = [
    [
      {
        kind: "projection_lag",
        requestedRevision: 8,
        appliedRevision: 6,
        canonicalRevision: 9,
      },
      "preserve_and_retry",
    ],
    [
      { kind: "rebuilding", generation: 2, appliedRevision: 5 },
      "preserve_and_retry",
    ],
    [
      { kind: "incompatible_view", expectedVersion: 2, actualVersion: 1 },
      "discard_cursor_and_reload",
    ],
    [{ kind: "expired_cursor" }, "discard_cursor_and_reload"],
    [{ kind: "restore_invalidated" }, "discard_cursor_and_reload"],
    [
      {
        kind: "reconciliation_required",
        reason: "projection_rebuilt",
        freshViewAvailable: true,
      },
      "discard_cursor_and_reload",
    ],
    [{ kind: "deleted_owner", ownerId: "conv_deleted" }, "clear_and_close"],
    [
      { kind: "access_denied", reason: "project_access_revoked" },
      "clear_protected_rows",
    ],
  ];

  for (const [outcome, expected] of cases) {
    it(`maps ${outcome.kind} to ${expected}`, () => {
      assert.equal(reconcileTimelineOutcome(outcome).kind, expected);
    });
  }

  it("allows only page outcomes to add canonical rows", () => {
    const page = { entries: [] };
    const result = reconcileTimelineOutcome({
      kind: "page",
      page,
    } as unknown as TimelineViewOutcome);
    assert.deepEqual(result, { kind: "apply_page", page });
  });
});
