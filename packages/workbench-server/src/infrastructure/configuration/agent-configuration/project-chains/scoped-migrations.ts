import { z } from "zod";
import {
  agentPreferencesSchema,
  conversationDefaultsSchema,
  leadSettingsOverridesSchema,
} from "@nervekit/contracts/agent-configuration";
import { integrationsConfigSchema } from "@nervekit/contracts/settings";
import type { ProjectConfigurationType } from "../../project-migration/project-migration.js";
import { legacySubagentCatalog } from "./frozen/subagent-catalog.js";
import {
  migrateCapabilitiesV2,
  migrateIntegrationsV1,
} from "./frozen/single-file-versions.js";

export const projectAgentConfiguration: ProjectConfigurationType<
  z.infer<typeof agentPreferencesSchema>
> = {
  id: "agent-settings",
  label: "Project agent settings",
  resetDescription:
    "Remove this override file; lower-precedence agent settings will apply.",
  fallbackDescription:
    "Lower-precedence agent settings apply while this override is unavailable.",
  path: "config/agent.json",
  currentVersion: 1,
  version: { field: "schemaVersion", absent: 1 },
  migrators: {},
  legacyFiles: ["config/harness.json"],
  schema: agentPreferencesSchema,
  fallback: () => ({ schemaVersion: 1, revision: 0, overrides: {} }),
  reset: () => null,
};
export const projectConversationDefaults: ProjectConfigurationType<
  z.infer<typeof conversationDefaultsSchema>
> = {
  id: "conversation-defaults",
  label: "Project conversation defaults",
  resetDescription:
    "Remove this override file; lower-precedence conversation defaults will apply.",
  fallbackDescription:
    "Lower-precedence conversation defaults apply while this override is unavailable.",
  path: "config/conversation-defaults.json",
  currentVersion: 1,
  version: { field: "schemaVersion", absent: 1 },
  migrators: {},
  legacyFiles: ["config/harness.json"],
  schema: conversationDefaultsSchema,
  fallback: () => ({ schemaVersion: 1, revision: 0, overrides: {} }),
  reset: () => null,
};
export const projectIntegrations: ProjectConfigurationType<
  z.infer<typeof integrationsConfigSchema>
> = {
  id: "integrations",
  label: "Project integrations",
  resetDescription:
    "Remove this override file; user integration settings will apply.",
  path: "config/integrations.json",
  currentVersion: 2,
  version: { field: "version", absent: 1 },
  migrators: { 1: migrateIntegrationsV1 },
  schema: integrationsConfigSchema,
  fallback: () =>
    integrationsConfigSchema.parse({
      version: 2,
      profiles: { atlassian: [], tavily: [] },
    }),
  reset: () => null,
};

export const projectSubagentCatalog: ProjectConfigurationType<{
  version: 2;
  schemaVersion: 1;
  profiles: Record<string, unknown>;
}> = {
  id: "subagents",
  label: "Project subagents",
  resetDescription:
    "Remove the invalid project subagent catalog; valid individual profile files will be preserved.",
  path: "config/subagents.json",
  legacyFiles: ["subagents/*.md"],
  currentVersion: 2,
  version: { field: "version", absent: 1 },
  migrators: {
    1: (value) => ({ ...legacySubagentCatalog(value), version: 2 }),
  },
  schema: z
    .object({
      version: z.literal(2),
      schemaVersion: z.literal(1),
      profiles: z.record(z.string(), z.unknown()),
    })
    .strict(),
  fallback: () => ({ version: 2, schemaVersion: 1, profiles: {} }),
  reset: () => null,
};

export const projectCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(3),
    overrides: leadSettingsOverridesSchema.pick({ tools: true, skills: true }),
  })
  .strict();
export const projectCapabilitiesConfiguration: ProjectConfigurationType<
  z.infer<typeof projectCapabilitiesSchema>
> = {
  fallbackDescription:
    "Lower-precedence capability settings apply while this override is unavailable.",
  id: "capabilities",
  label: "Project capabilities",
  resetDescription:
    "Remove this override file; lower-precedence capability settings will apply.",
  path: "config/capabilities.json",
  currentVersion: 3,
  version: { field: "schemaVersion", absent: 2 },
  migrators: { 2: migrateCapabilitiesV2 },
  schema: projectCapabilitiesSchema,
  fallback: () => ({ schemaVersion: 3, overrides: {} }),
  reset: () => null,
};
