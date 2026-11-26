import type {
  ConfigurationResource,
  ConfigurationResourceKind,
} from "@nervekit/contracts/configuration";

/** An item's decision state when it waits or was declined; trusted items need nothing. */
export type PendingReviewState = "needs_review" | "declined";

/**
 * What the registry reports for one item: Needs review or Declined, else
 * undefined. Lists whose own data carries no decision (user rule sets, the
 * user overlay) read it from `configuration.attention`.
 */
export function pendingReviewState(
  resources: readonly ConfigurationResource[],
  kind: ConfigurationResourceKind,
  scope: "user" | "project",
  id: string,
): PendingReviewState | undefined {
  const resource = resources.find(
    (entry) => entry.kind === kind && entry.scope === scope && entry.id === id,
  );
  return resource?.state === "needs_review" || resource?.state === "declined"
    ? resource.state
    : undefined;
}
