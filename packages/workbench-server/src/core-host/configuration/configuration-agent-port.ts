import type {
  ConfigurationAgentPort,
  ConfigurationAgentScope,
} from "@nervekit/tools/quick-script";
import type {
  ConfigurationResourceRegistry,
  ResourceContext,
} from "./resource-registry.js";

/**
 * The `configuration.*` quick_script namespace for one conversation: validates the files an agent
 * edited by hand, activates the valid ones and reports what is still wrong. It writes no file and
 * never grants trust. Each owner validates its own resources through its provider; this port adds
 * no validation of its own.
 */
export function createConfigurationAgentPort(options: {
  registry: ConfigurationResourceRegistry;
  /** The conversation's project, which the scope `"project"` names. */
  projectId: string;
  projectDirectory: string | undefined;
  conversationId: string;
}): ConfigurationAgentPort {
  const context = (scope: ConfigurationAgentScope): ResourceContext => ({
    scope,
    projectId: options.projectId,
    ...(options.projectDirectory
      ? { projectDirectory: options.projectDirectory }
      : {}),
    conversationId: options.conversationId,
  });
  return {
    check: async (scope) => ({
      resources: await options.registry.check(context(scope)),
    }),
    reload: async (scope) => ({
      resources: await options.registry.reload(context(scope)),
    }),
  };
}
