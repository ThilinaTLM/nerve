import { createHash } from "node:crypto";
import type { TrustedResourceService } from "@nervekit/conversation-core";

export type PromptSuggestionTrustRecord = {
  trustId: string;
  resourceId?: string;
  sourceKind: "user" | "project";
  projectId?: string;
  path: string;
  name: string;
  label: string;
  predicateHash: string;
  status: "allowed" | "denied";
};

/** Maps the feature's predicate identity to the core's path/content trust. */
export class PromptSuggestionTrustRepository {
  constructor(private readonly trust: TrustedResourceService) {}

  list(projectId?: string): PromptSuggestionTrustRecord[] {
    return [
      ...this.trust.list(null, "prompt_suggestion"),
      ...(projectId ? this.trust.list(projectId, "prompt_suggestion") : []),
    ].map((resource) => {
      const sourceKind = resource.projectId ? "project" : "user";
      return {
        trustId: createHash("sha256")
          .update(
            `${sourceKind}\0${resource.path}\0${resource.name}\0${resource.contentDigest}`,
          )
          .digest("hex"),
        resourceId: resource.id,
        sourceKind,
        projectId: resource.projectId ?? undefined,
        path: resource.path,
        name: resource.name ?? resource.path,
        label: resource.name ?? resource.path,
        predicateHash: resource.contentDigest,
        status: resource.status === "trusted" ? "allowed" : "denied",
      };
    });
  }

  set(record: PromptSuggestionTrustRecord): void {
    this.trust.decide({
      kind: "prompt_suggestion",
      projectId: record.projectId ?? null,
      path: record.path,
      name: record.name,
      contentDigest: record.predicateHash,
      status: record.status === "allowed" ? "trusted" : "rejected",
    });
  }

  remove(record: PromptSuggestionTrustRecord): void {
    if (record.resourceId) this.trust.delete(record.resourceId);
  }
}
