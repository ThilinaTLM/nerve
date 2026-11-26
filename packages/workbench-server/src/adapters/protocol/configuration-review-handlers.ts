import type { ServerAdapterContexts } from "../contexts.js";
import { discoverSkillFiles } from "../../core-host/resources/resource-loader.js";
import { ConfigurationReviewService } from "../../core-host/configuration/review/configuration-review.js";

type ChannelContext = ServerAdapterContexts["websocket"];

/**
 * `configuration.review` and `configuration.decide` (docs/architecture/trust.md):
 * the user's review of any configuration item and the decision on exactly what they saw. Protocol
 * operations of the signed-in app only; no agent tool, `quick_script` namespace or extension bridge
 * reaches them (`trust-surfaces.test.ts`).
 */
export function configurationReviewHandlers(
  state: ChannelContext,
  hooks: {
    /** Re-evaluates admission, resources and calls that waited on configuration. */
    published(): void;
    mcpApprovalChanged(projectId: string | null): void;
  },
) {
  const core = state.conversationCore;
  const platform = state.operationContexts.platform;
  const home = state.storage.paths.home;
  const review = new ConfigurationReviewService({
    home,
    trust: core.trust,
    projectDirectory: (projectId) => core.projects.get(projectId)?.directory,
    agentPaths: state.agentConfiguration.paths,
    skills: (directory) => discoverSkillFiles(directory, home),
    suggestions: state.operationContexts.projects.promptSuggestions,
    extensions: platform.extensionCatalog,
    mcp: platform.mcp,
    profileRuleSetId: async (name, projectId) => {
      const found = await state.agentConfiguration.profiles.get(
        name,
        projectId,
      );
      if (found.status !== "available") return undefined;
      return (
        found.definition.requirements?.permissionRuleSetId ??
        found.definition.recommendations?.permissionRuleSetId
      );
    },
    decided: async (target, path) => {
      hooks.published();
      const scope =
        target.scope === "project" && target.projectId
          ? ({ scope: "project", projectId: target.projectId } as const)
          : ({ scope: "user" } as const);
      switch (target.kind) {
        case "agent-preferences":
          state.agentConfiguration.invalidateResources();
          await state.agentConfiguration.reload(scope);
          break;
        case "agent-profile":
          state.agentConfiguration.invalidateResources();
          await state.agentConfiguration.profiles.reload(scope, target.id);
          break;
        case "rule-set":
        case "permission-overlay":
          if (path) await state.admissionPolicy.reload([path]);
          break;
        case "mcp-servers":
          hooks.mcpApprovalChanged(
            scope.scope === "project" ? scope.projectId : null,
          );
          break;
        default:
          // Skills, suggestions and extensions are read when used; extensions reloaded in their consent path.
          break;
      }
      await core.retryConfigurationBlocked();
      await core.reconcilePlanReviews();
    },
  });
  return {
    "configuration.review": (target) => review.review(target),
    "configuration.decide": async (decision) => {
      const decided = await review.decide(decision);
      // Every window and device refreshes what shows the item (bell, Settings, suggestions).
      state.events.publishBestEffort("configuration.decided", {
        target: decided.target,
        state: decided.state,
      });
      return decided;
    },
  } satisfies Partial<
    import("@nervekit/protocol/rpc").OperationHandlerRegistry
  >;
}
