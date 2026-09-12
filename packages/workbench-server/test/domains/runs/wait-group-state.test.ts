import assert from "node:assert/strict";
import test from "node:test";
import type { WaitGroup, WaitGroupMember } from "@nervekit/contracts/runs";
import {
  assertWaitGroupMemberTransition,
  consumeContinuation,
  effectiveWaitGroupState,
} from "../../../src/domains/runs/runtime/wait-group-state.js";

const hash = `sha256:${"a".repeat(64)}`;

function member(
  memberId: string,
  overrides: Partial<WaitGroupMember> = {},
): WaitGroupMember {
  return {
    schemaVersion: 1,
    memberId,
    waitGroupId: "wait_group_one",
    memberKind: "tool",
    ownerId: memberId.replace("member", "tool"),
    inputFingerprint: hash,
    executionState: "drafted",
    attachmentDisposition: "pending",
    contributesToBarrier: false,
    revision: 1,
    ...overrides,
  };
}

function group(members: WaitGroupMember[]): WaitGroup {
  return {
    schemaVersion: 1,
    waitGroupId: "wait_group_one",
    runId: "run_one",
    membershipManifestId: "manifest_one",
    continuationEntryId: "entry_one",
    continuationConsumed: false,
    state: "open",
    revision: 1,
    members,
  };
}

test("INV-BARRIER-01 does not settle a denial without non-dispatch evidence", () => {
  const denied = member("member_one", {
    executionState: "denied",
    attachmentDisposition: "not_executed",
    contributesToBarrier: false,
  });
  assert.equal(effectiveWaitGroupState(group([denied])), "open");

  const proved = {
    ...denied,
    nonDispatchEvidenceId: "evidence_one",
    contributesToBarrier: true,
  };
  assert.equal(effectiveWaitGroupState(group([proved])), "ready");
});

test("INV-BARRIER-01 permits an unchanged sibling without revising it", () => {
  const pending = member("member_sibling");
  assert.doesNotThrow(() =>
    assertWaitGroupMemberTransition(pending, { ...pending }),
  );
  assert.throws(
    () =>
      assertWaitGroupMemberTransition(pending, {
        ...pending,
        executionState: "authorized",
      }),
    /require a new revision/,
  );
});

test("INV-BARRIER-01 unknown and unavailable outcomes block continuation", () => {
  for (const state of ["outcome_unknown", "result_unavailable"] as const) {
    const unresolved = member("member_one", {
      executionState: state,
      attachmentDisposition: state,
    });
    assert.equal(
      effectiveWaitGroupState(group([unresolved])),
      "recovery_required",
    );
    assert.throws(
      () => consumeContinuation(group([unresolved])),
      /no continuation/,
    );
  }
});

test("INV-BARRIER-01 consumes continuation exactly once", () => {
  const settled = member("member_one", {
    executionState: "succeeded",
    attachmentDisposition: "attached",
    resultEntryId: "entry_result",
    contributesToBarrier: true,
  });
  const consumed = consumeContinuation(group([settled]));
  assert.equal(consumed.continuationConsumed, true);
  assert.equal(consumed.state, "closed");
  assert.throws(() => consumeContinuation(consumed), /no continuation/);
});

test("INV-BARRIER-01 prevents settled members from reopening or replacing results", () => {
  const settled = member("member_one", {
    executionState: "succeeded",
    attachmentDisposition: "attached",
    resultEntryId: "entry_result",
    contributesToBarrier: true,
  });
  assert.throws(
    () =>
      assertWaitGroupMemberTransition(settled, {
        ...settled,
        executionState: "closed",
        attachmentDisposition: "detached",
        resultEntryId: "entry_other",
        contributesToBarrier: false,
        revision: 2,
      }),
    /cannot be reopened/,
  );
});
