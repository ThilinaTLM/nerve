import assert from "node:assert/strict";
import test from "node:test";
import type { ContextBoundary } from "@nervekit/contracts/conversations";
import {
  selectContextBoundary,
  type ContextBoundaryCandidate,
  type ContextBoundaryProofPort,
} from "../../../src/domains/conversations/timeline/context-boundary-selection.js";

const hash = `sha256:${"a".repeat(64)}`;
const artifact = {
  artifactId: "artifact_manifest",
  ownerKind: "conversation" as const,
  ownerId: "conv_one",
  relativeLocator: "manifests/one.json",
  digest: hash,
  byteLength: 10,
  mediaType: "application/json",
  semanticRole: "context_source_manifest",
  availability: "available" as const,
};

function boundary(
  id: string,
  anchor: string,
  sourceTip: string,
): ContextBoundary {
  return {
    schemaVersion: 1,
    boundaryId: `boundary_${id}`,
    conversationId: "conv_one",
    transitionId: `transition_${id}`,
    anchorEntryId: `entry_${anchor}`,
    sourceTipEntryId: `entry_${sourceTip}`,
    sourceManifest: {
      schemaVersion: 1,
      conversationId: "conv_one",
      sourceTipEntryId: `entry_${sourceTip}`,
      entryCount: 3,
      entriesManifest: artifact,
      transitiveBoundaryCount: 0,
      digest: hash,
    },
    policyVersion: 1,
    providerAdapterVersion: "test-v1",
    recipeVersion: 1,
  };
}

const depths = new Map([
  ["entry_a", 1],
  ["entry_b", 2],
  ["entry_c", 3],
]);
const proof: ContextBoundaryProofPort = {
  isAncestor: async (_conversationId, ancestor, descendant) =>
    ancestor === null ||
    ancestor === descendant ||
    (depths.get(ancestor!) ?? Infinity) <= (depths.get(descendant!) ?? -1),
  entryDepth: async (_conversationId, entryId) =>
    entryId === null ? -1 : (depths.get(entryId) ?? -1),
  manifestInputsAreEligible: async () => true,
};

function candidate(
  value: ContextBoundary,
  commitRevision: number,
  ordinal = 0,
): ContextBoundaryCandidate {
  return { boundary: value, commitRevision, withinTransitionOrdinal: ordinal };
}

test("INV-CONTEXT-01 prefers the deepest eligible branch anchor", async () => {
  const selected = await selectContextBoundary(
    {
      conversationId: "conv_one",
      selectedHeadEntryId: "entry_c",
      viewRevision: 20,
      contextPolicyVersion: 1,
      visibilityId: "default",
      candidates: [
        candidate(boundary("shallow", "a", "a"), 10),
        candidate(boundary("deep", "b", "b"), 9),
      ],
    },
    proof,
  );
  assert.equal(selected?.boundary.boundaryId, "boundary_deep");
});

test("INV-CONTEXT-01 rejects off-branch or transitively ineligible summaries", async () => {
  const selected = await selectContextBoundary(
    {
      conversationId: "conv_one",
      selectedHeadEntryId: "entry_a",
      viewRevision: 20,
      contextPolicyVersion: 1,
      visibilityId: "restricted",
      candidates: [candidate(boundary("sibling", "b", "c"), 10)],
    },
    {
      ...proof,
      manifestInputsAreEligible: async () => false,
    },
  );
  assert.equal(selected, undefined);
});

test("INV-CONTEXT-01 uses revision, ordinal, then identity as deterministic tie breakers", async () => {
  const selected = await selectContextBoundary(
    {
      conversationId: "conv_one",
      selectedHeadEntryId: "entry_c",
      viewRevision: 20,
      contextPolicyVersion: 1,
      visibilityId: "default",
      candidates: [
        candidate(boundary("z", "b", "b"), 10, 1),
        candidate(boundary("a", "b", "b"), 11, 0),
        candidate(boundary("b", "b", "b"), 11, 0),
      ],
    },
    proof,
  );
  assert.equal(selected?.boundary.boundaryId, "boundary_a");
});
