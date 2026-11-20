import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import type { PromptSuggestionService } from "../../../domains/prompt-suggestions/prompt-suggestion.service.js";
import {
  approvalDiagnostic,
  type ConfigurationResourceProvider,
  type ResourceContext,
} from "../resource-registry.js";

const APPROVAL = { kind: "trust", where: "Settings → Suggestions" } as const;

/**
 * Prompt suggestions. They are read from disk on every use, so reload equals check. A suggestion
 * with an `enable` predicate runs code and waits for the user's approval.
 */
export function promptSuggestionProvider(options: {
  suggestions: Pick<PromptSuggestionService, "listForProject">;
  /** Folder of the user's suggestions; a diagnostic outside it belongs to the project. */
  userDirectory: string;
}): ConfigurationResourceProvider {
  async function all(
    context: ResourceContext,
  ): Promise<ConfigurationResource[]> {
    const listing = await options.suggestions.listForProject(context.projectId);
    const found = listing.statuses
      .filter(
        (status) =>
          status.sourceKind === context.scope ||
          (context.scope === "user" && status.sourceKind === "builtin"),
      )
      .map((status): ConfigurationResource => {
        const pending =
          status.requiresTrust &&
          (status.status === "unset" || status.status === "stale");
        return {
          kind: "prompt-suggestion",
          id: status.name,
          scope: status.sourceKind,
          ...(status.sourceKind === "builtin" ? {} : { path: status.path }),
          state: status.overriddenBy
            ? "shadowed"
            : pending
              ? "needs_approval"
              : !status.enabled || status.status === "denied"
                ? "disabled"
                : "active",
          ...(status.overriddenBy && status.overriddenBy !== "builtin"
            ? { shadowedBy: status.overriddenBy }
            : {}),
          ...(pending && !status.overriddenBy ? { approval: APPROVAL } : {}),
          diagnostics:
            pending && !status.overriddenBy
              ? [approvalDiagnostic(APPROVAL)]
              : [],
        };
      });
    const byPath = new Map(found.map((entry) => [entry.path, entry]));
    for (const { path, ...diagnostic } of listing.diagnostics ?? []) {
      const scope = path.startsWith(options.userDirectory) ? "user" : "project";
      if (scope !== context.scope) continue;
      let entry = byPath.get(path);
      if (!entry) {
        entry = {
          kind: "prompt-suggestion",
          id: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
          scope,
          path,
          state: "invalid",
          diagnostics: [],
        };
        byPath.set(path, entry);
        found.push(entry);
      }
      entry.diagnostics.push(diagnostic);
    }
    return found;
  }
  const problems = async (context: ResourceContext) =>
    (await all(context)).filter((entry) => entry.diagnostics.length > 0);
  return {
    kinds: ["prompt-suggestion"],
    list: all,
    check: problems,
    reload: problems,
  };
}
