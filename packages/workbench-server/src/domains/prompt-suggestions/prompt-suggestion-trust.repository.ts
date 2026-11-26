import { toTrustedDigest, type TrustState } from "@nervekit/contracts/core";
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
  status: "trusted" | "declined";
};

/** What identifies a predicate: where it lives and its source hash. */
export type PromptSuggestionPredicate = {
  predicateHash?: string | undefined;
  source: {
    kind: "builtin" | "user" | "project";
    path: string;
    projectId?: string | undefined;
  };
};

/** Maps the feature's predicate identity to the core's path/content trust. */
export class PromptSuggestionTrustRepository {
  constructor(private readonly trust: TrustedResourceService) {}

  /** The state of a definition's predicate; a decline stays whatever the predicate says now. */
  state(definition: PromptSuggestionPredicate): TrustState {
    if (!definition.predicateHash || definition.source.kind === "builtin")
      return "needs_review";
    return this.trust.state(
      "prompt_suggestion",
      definition.source.kind === "project"
        ? (definition.source.projectId ?? null)
        : null,
      definition.source.path,
      toTrustedDigest(definition.predicateHash),
    );
  }

  list(projectId?: string): PromptSuggestionTrustRecord[] {
    return [
      ...this.trust.list(null, "prompt_suggestion"),
      ...(projectId ? this.trust.list(projectId, "prompt_suggestion") : []),
    ].map((resource) => {
      const sourceKind = resource.projectId ? "project" : "user";
      return {
        trustId: createHash("sha256")
          .update(
            `${sourceKind}\0${resource.resourceKey}\0${resource.name}\0${resource.contentDigest}`,
          )
          .digest("hex"),
        resourceId: resource.id,
        sourceKind,
        projectId: resource.projectId ?? undefined,
        path: resource.resourceKey,
        name: resource.name ?? resource.resourceKey,
        label: resource.name ?? resource.resourceKey,
        predicateHash: resource.contentDigest.replace(/^sha256:/, ""),
        status: resource.status === "trusted" ? "trusted" : "declined",
      };
    });
  }
}
