import type { CoreStorage } from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import type { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { ExtensionCatalog } from "../extensions/extension-catalog/extension-catalog.js";
import type { ScopedPermissionPolicySource } from "../permissions/scoped-permission-source.js";
import { agentConfigurationProvider } from "./providers/agent-configuration-provider.js";
import { extensionProvider } from "./providers/extension-provider.js";
import { launchProvider } from "./providers/launch-provider.js";
import { permissionProvider } from "./providers/permission-provider.js";
import { skillProvider } from "./providers/skill-provider.js";
import { createProjectSkillTrust } from "../resources/project-skill-trust.js";
import { ConfigurationResourceRegistry } from "./resource-registry.js";

/**
 * The registry with the providers the conversation core owns. Other owners register theirs
 * (prompt suggestions). Order matters for reload: rule sets before the preferences that select them.
 */
export function createResourceRegistry(options: {
  home: string;
  agentConfiguration: AgentConfigurationService;
  policy: ScopedPermissionPolicySource;
  trustedResources: Pick<CoreStorage["trustedResources"], "find">;
  launchDefinitions: Pick<LaunchDefinitionService, "problem">;
  extensionCatalog: Pick<ExtensionCatalog, "entries" | "reload">;
  builtinSkills(): readonly Skill[];
}): ConfigurationResourceRegistry {
  const registry = new ConfigurationResourceRegistry();
  registry.register(
    permissionProvider({
      policy: options.policy,
      trustedResources: options.trustedResources,
    }),
  );
  registry.register(
    agentConfigurationProvider({
      service: options.agentConfiguration,
      selectableRuleSetIds: () => options.policy.selectableRuleSetIds(),
    }),
  );
  registry.register(
    launchProvider({ launchDefinitions: options.launchDefinitions }),
  );
  registry.register(
    skillProvider({
      storageHome: options.home,
      builtin: options.builtinSkills,
      trust: createProjectSkillTrust(options.trustedResources),
    }),
  );
  registry.register(
    extensionProvider({
      catalog: options.extensionCatalog,
      home: options.home,
    }),
  );
  return registry;
}
