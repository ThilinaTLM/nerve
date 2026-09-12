import type { CommitConversationCommandInput } from "./timeline-command-contracts.js";

export function assertTimelineCommandBudgets(
  input: CommitConversationCommandInput,
): void {
  const boundedCollections: Array<[string, readonly unknown[], number]> = [
    ["expected heads", input.expectedHeads, 64],
    ["run fences", input.expectedRunFences ?? [], 64],
    ["transitions", input.transitions, 64],
    ["context boundaries", input.contextBoundaries ?? [], 64],
    ["finalized artifacts", input.finalizedArtifacts ?? [], 128],
    ["artifact manifests", input.artifactManifests ?? [], 128],
    ["run controls", input.runControls ?? [], 64],
    ["execution snapshots", input.executionSnapshots ?? [], 64],
    ["wait groups", input.waitGroups ?? [], 64],
    ["checkpoints", input.checkpoints ?? [], 64],
    ["policy observations", input.policyObservations ?? [], 128],
    ["policy diagnostics", input.policyDiagnostics ?? [], 128],
    ["policy fallback decisions", input.policyFallbackDecisions ?? [], 128],
    ["policy save intents", input.policySaveIntents ?? [], 128],
    ["deletion intents", input.deletionIntents ?? [], 64],
    ["authorizations", input.authorizations ?? [], 128],
    ["logical effects", input.logicalEffects ?? [], 128],
    ["provider phases", input.providerPhases ?? [], 64],
    ["execution attempts", input.executionAttempts ?? [], 256],
    ["execution claims", input.executionClaims ?? [], 128],
    ["recovery actions", input.recoveryActions ?? [], 128],
    ["publication intents", input.publicationIntents, 128],
  ];
  for (const [label, values, maximum] of boundedCollections) {
    if (values.length > maximum) {
      throw new RangeError(
        `Canonical command exceeds ${label} limit ${maximum}.`,
      );
    }
  }
  const entryCount = input.transitions.reduce(
    (total, transition) => total + transition.entries.length,
    0,
  );
  if (entryCount > 256) {
    throw new RangeError("Canonical command exceeds total entry limit 256.");
  }
}
