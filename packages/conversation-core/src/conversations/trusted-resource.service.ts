import { createId } from "@nervekit/contracts";
import { trustedResourceGrantsSchema } from "@nervekit/contracts/core";
import type {
  TrustDecision,
  TrustState,
  TrustedResource,
  TrustedResourceKind,
} from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";

export class TrustedResourceService {
  private currentGeneration = 0;
  get generation(): number {
    return this.currentGeneration;
  }
  constructor(
    private readonly storage: CoreStorage,
    private readonly now: () => string,
  ) {}
  list(projectId: string | null, kind?: TrustedResourceKind) {
    return this.storage.trustedResources.list(projectId, kind);
  }
  find(
    kind: TrustedResourceKind,
    projectId: string | null,
    resourceKey: string,
  ): TrustedResource | null {
    return this.storage.trustedResources.find(kind, projectId, resourceKey);
  }
  /** Records the user's decision, replacing an earlier one for the same resource. `grants` is validated for the kind; left out, an existing decision keeps its grants. */
  decide(input: TrustDecision & { id?: string }): TrustedResource {
    const existing = this.find(input.kind, input.projectId, input.resourceKey);
    const grants = trustedResourceGrantsSchema(input.kind).parse(
      input.grants === undefined ? (existing?.grants ?? null) : input.grants,
    );
    const now = this.now();
    const result = existing
      ? this.storage.trustedResources.update(existing.id, {
          name: input.name,
          contentDigest: input.contentDigest,
          status: input.status,
          grants,
          updatedAt: now,
        })
      : this.storage.trustedResources.insert({
          id: input.id ?? createId("trust"),
          kind: input.kind,
          projectId: input.projectId,
          resourceKey: input.resourceKey,
          name: input.name,
          contentDigest: input.contentDigest,
          status: input.status,
          grants,
          createdAt: now,
          updatedAt: now,
        });
    this.currentGeneration++;
    return result;
  }
  /**
   * The one place that maps a stored row to what the user sees: no row is `needs_review`; a
   * `rejected` row is `declined` whatever the content now is; a `trusted` row is `trusted` only
   * for the digest it names, else `needs_review`.
   */
  trustState(
    resource:
      | Pick<TrustedResource, "status" | "contentDigest">
      | null
      | undefined,
    contentDigest: string,
  ): TrustState {
    if (!resource) return "needs_review";
    if (resource.status === "rejected") return "declined";
    return resource.contentDigest === contentDigest
      ? "trusted"
      : "needs_review";
  }
  state(
    kind: TrustedResourceKind,
    projectId: string | null,
    resourceKey: string,
    contentDigest: string,
  ): TrustState {
    return this.trustState(
      this.find(kind, projectId, resourceKey),
      contentDigest,
    );
  }
  isTrusted(
    kind: TrustedResourceKind,
    projectId: string | null,
    resourceKey: string,
    contentDigest: string,
  ): boolean {
    return (
      this.state(kind, projectId, resourceKey, contentDigest) === "trusted"
    );
  }
  delete(id: string) {
    this.storage.trustedResources.delete(id);
    this.currentGeneration++;
  }
}
