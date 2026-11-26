import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import { mcpItemId } from "$lib/application/mcp/mcp-item";

/** The settings page that shows one reviewable item ("Details" in the review dialog). */
export type ReviewTargetPage = {
  scope: "user" | "project";
  projectId?: string;
  pageId: string;
  /** Opens the item's own page when the settings page has one. */
  item?: string;
};

/** Which of the two profile pages lists a profile; Agents when unknown. */
export type ReviewProfilePageOf = (
  target: ConfigurationReviewTarget,
) => "agents" | "sub-agents" | undefined;

/** Two items with the same kind, scope, project and id are the same item. */
export function sameReviewTarget(
  a: ConfigurationReviewTarget,
  b: ConfigurationReviewTarget,
): boolean {
  return (
    a.kind === b.kind &&
    a.scope === b.scope &&
    a.id === b.id &&
    (a.scope === "user" || a.projectId === b.projectId)
  );
}

export function reviewTargetKey(target: ConfigurationReviewTarget): string {
  return [target.kind, target.scope, target.projectId ?? "", target.id].join(
    "\u0000",
  );
}

/** Where an item is listed and decided in Settings. */
export function reviewTargetPage(
  target: ConfigurationReviewTarget,
  profilePageOf?: ReviewProfilePageOf,
): ReviewTargetPage | undefined {
  const { scope, id } = target;
  const base = {
    scope,
    ...(scope === "project" && target.projectId
      ? { projectId: target.projectId }
      : {}),
  };
  switch (target.kind) {
    case "agent-profile":
      return {
        ...base,
        pageId: profilePageOf?.(target) ?? "agents",
        item: `${scope}:${id}`,
      };
    case "skill":
      return { ...base, pageId: "skills", item: `${scope}:${id}` };
    case "extension":
      return { ...base, pageId: "extensions", item: id };
    case "prompt-suggestion":
      return {
        ...base,
        pageId: "suggestions",
        // The enablement file is decided on the list; a suggestion on its page.
        ...(id.endsWith(".json")
          ? {}
          : {
              item:
                scope === "project"
                  ? `project:${target.projectId ?? ""}:${id}`
                  : `user:${id}`,
            }),
      };
    case "mcp-servers":
      return id === "mcp.json"
        ? { ...base, pageId: "mcp-servers" }
        : { ...base, pageId: "mcp-servers", item: mcpItemId(scope, id) };
    case "rule-set":
      return { ...base, pageId: "permission-rules", item: id };
    case "permission-overlay":
      return { ...base, pageId: "permission-rules" };
    case "agent-preferences":
      return { ...base, pageId: "general" };
    case "launch-catalog":
      return undefined;
  }
}
