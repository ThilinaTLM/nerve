import { projectProfileConfiguration } from "../agent-configuration/project-chains/profile-migrations.js";
import { suggestionConfiguration } from "../../../domains/prompt-suggestions/prompt-suggestion-migrations.js";
import {
  projectAgentConfiguration,
  projectConversationDefaults,
  projectIntegrations,
  projectSubagentCatalog,
  projectCapabilitiesConfiguration,
} from "../agent-configuration/project-chains/scoped-migrations.js";
import { projectPermissionsConfiguration } from "../../../core-host/project-permission-migrations.js";
import type { TrustedResourceKind } from "@nervekit/contracts/core";
import { launchDefinitionsConfiguration } from "../../../domains/launch-definitions/launch-definition-migrations.js";
import type { ProjectConfigurationType } from "./project-migration.js";

/** The single registration point for lazy project configuration types. */
export const projectConfigurationDescriptors: readonly {
  type: ProjectConfigurationType<unknown>;
  trustKind?: TrustedResourceKind;
}[] = [
  { type: launchDefinitionsConfiguration },
  { type: projectAgentConfiguration, trustKind: "project_capabilities" },
  { type: projectConversationDefaults },
  { type: projectIntegrations },
  { type: projectCapabilitiesConfiguration, trustKind: "project_capabilities" },
  { type: projectSubagentCatalog, trustKind: "agent_profile" },
  { type: projectPermissionsConfiguration, trustKind: "project_permissions" },
];

export const projectConfigurationTrustKinds: Readonly<
  Record<string, TrustedResourceKind>
> = {
  "agent-profile": "agent_profile",
  "prompt-suggestion": "prompt_suggestion",
  ...Object.fromEntries(
    projectConfigurationDescriptors.flatMap(({ type, trustKind }) =>
      trustKind ? [[type.id, trustKind]] : [],
    ),
  ),
};

/** Entry descriptors are registered lazily by their owner, never by scanning projects. */
export const projectConfigurationFactories = {
  "agent-profile": projectProfileConfiguration,
  "prompt-suggestion": suggestionConfiguration,
};
