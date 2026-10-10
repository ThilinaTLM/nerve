import { createId } from "@nervekit/contracts";
import type {
  TrustedResource,
  TrustedResourceKind,
} from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";

export class TrustedResourceService {
  constructor(
    private readonly storage: CoreStorage,
    private readonly now: () => string,
  ) {}
  list(projectId: string | null, kind?: TrustedResourceKind) {
    return this.storage.trustedResources.list(projectId, kind);
  }
  decide(
    input: Omit<TrustedResource, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): TrustedResource {
    const existing = this.storage.trustedResources.find(
      input.kind,
      input.projectId,
      input.path,
    );
    const now = this.now();
    if (existing)
      return this.storage.trustedResources.update(existing.id, {
        name: input.name,
        contentDigest: input.contentDigest,
        status: input.status,
        updatedAt: now,
      });
    return this.storage.trustedResources.insert({
      ...input,
      id: input.id ?? createId("trust"),
      createdAt: now,
      updatedAt: now,
    });
  }
  isTrusted(
    kind: TrustedResourceKind,
    projectId: string | null,
    path: string,
    contentDigest: string,
  ): boolean {
    const resource = this.storage.trustedResources.find(kind, projectId, path);
    return (
      resource?.status === "trusted" && resource.contentDigest === contentDigest
    );
  }
  delete(id: string) {
    this.storage.trustedResources.delete(id);
  }
}
