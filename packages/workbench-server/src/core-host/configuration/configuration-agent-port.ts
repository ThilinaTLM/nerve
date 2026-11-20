import type {
  ConfigurationAgentPort,
  ConfigurationAgentScope,
} from "@nervekit/tools/quick-script";
import type {
  ConfigurationResourceRegistry,
  ResourceContext,
} from "./resource-registry.js";
import {
  createConversationView,
  type ConversationViewOptions,
} from "./conversation-view.js";

/**
 * The `configuration.*` quick_script namespace for one conversation: validates the files an agent
 * edited by hand, activates the valid ones and reports what is still wrong. It writes no file and
 * never grants trust. Each owner validates its own resources through its provider; this port adds
 * no validation of its own.
 */
export function createConfigurationAgentPort(
  options: ConversationViewOptions & {
    registry: ConfigurationResourceRegistry;
  },
): ConfigurationAgentPort {
  const projectId =
    options.agentConfiguration.paths.locations.conversationOwner(
      options.conversationId,
    ).projectId;
  const context = (scope: ConfigurationAgentScope): ResourceContext => ({
    scope,
    projectId,
    projectDirectory: options.projectDirectory,
    conversationId: options.conversationId,
  });
  return {
    // `describe`, `tools` and `explain` read this conversation rather than files.
    ...createConversationView(options),
    async list(filter) {
      const scopes: ConfigurationAgentScope[] =
        filter.scope === "project"
          ? ["project"]
          : filter.scope === undefined
            ? ["user", "project"]
            : ["user"];
      const found = (
        await Promise.all(
          scopes.map((scope) => options.registry.list(context(scope))),
        )
      ).flat();
      return {
        resources: found.filter(
          (resource) =>
            (filter.kind === undefined || resource.kind === filter.kind) &&
            (filter.scope === undefined || resource.scope === filter.scope) &&
            (filter.state === undefined || resource.state === filter.state),
        ),
      };
    },
    check: async (scope) => ({
      resources: await options.registry.check(context(scope)),
    }),
    reload: async (scope) => ({
      resources: await options.registry.reload(context(scope)),
    }),
  };
}
