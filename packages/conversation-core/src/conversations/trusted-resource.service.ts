import { createId } from "@nervekit/contracts";
import { trustedResourceGrantsSchema } from "@nervekit/contracts/core";
import type {
  TrustDecision,
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
  isTrusted(
    kind: TrustedResourceKind,
    projectId: string | null,
    resourceKey: string,
    contentDigest: string,
  ): boolean {
    const resource = this.find(kind, projectId, resourceKey);
    return (
      resource?.status === "trusted" && resource.contentDigest === contentDigest
    );
  }
  delete(id: string) {
    this.storage.trustedResources.delete(id);
    this.currentGeneration++;
  }
}
