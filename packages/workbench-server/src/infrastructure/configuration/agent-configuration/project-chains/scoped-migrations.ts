import { legacySubagentCatalog } from "./frozen/subagent-catalog.js";
import { z } from "zod";
import {
  agentPreferencesSchema,
  conversationDefaultsSchema,
  leadSettingsOverridesSchema,
  canonicalSettingsEntries,
  applySettingsMutation,
} from "@nervekit/contracts/agent-configuration";
import { integrationsConfigSchema } from "@nervekit/contracts/settings";
import type {
  ProjectConfigurationType,
  ProjectLegacyInput,
} from "../../project-migration/project-migration.js";
import {
  convertPreferencesV037,
  convertCapabilitiesV037,
  splitCatalogV037,
  merge,
  type Data,
  type ConversionContext,
} from "./frozen/released-format.js";
import baseline from "./frozen/released-baseline.json" with { type: "json" };

export const releasedBuiltins = Object.fromEntries(
  baseline.builtins.map((profile) => [profile.name, profile]),
);
export function releasedContext(inputs: Data): ConversionContext {
  const skills: Record<string, ("file" | "nerve" | "agentBrowser")[]> = {};
  for (const name of ["planning", "team-lead", "skill-creator"])
    skills[name] = ["nerve"];
  for (const source of ["file", "nerve", "agentBrowser"] as const) {
    for (const name of Object.keys(
      (inputs.capabilities?.overrides ?? inputs.capabilities)?.skills?.[
        source
      ] ?? {},
    ))
      (skills[name] ??= []).push(source);
    for (const name of source === "file"
      ? (inputs.harness?.skills?.disabled ?? [])
      : (inputs.harness?.skills?.[source]?.enabled ?? []))
      (skills[name] ??= []).push(source);
  }
  return {
    builtins: releasedBuiltins,
    skillSources: skills,
    inheritedSettings: {},
    report: () => {},
  };
}
export const scopeLegacyInputs: readonly ProjectLegacyInput[] = [
  {
    path: "config/harness.json",
    currentVersion: 3,
    version: { field: "version", absent: 3 },
  },
  {
    path: "config/capabilities.json",
    currentVersion: 3,
    version: { field: "schemaVersion", absent: 2 },
    trustKind: "project_capabilities",
  },
  {
    path: "config/subagents.json",
    currentVersion: 2,
    version: { field: "version", absent: 1 },
    trustKind: "agent_profile",
  },
  {
    path: "config/integrations.json",
    currentVersion: 2,
    version: { field: "version", absent: 1 },
  },
];
function scopeInputs(inputs: Readonly<Record<string, unknown>>): Data {
  return Object.fromEntries(
    Object.entries(inputs).map(([path, value]) => [
      path.slice("config/".length, -".json".length),
      value,
    ]),
  );
}
export function migrateScopedInputs(inputs: Readonly<Record<string, unknown>>) {
  const before = scopeInputs(inputs);
  // v2 integrations no longer contribute tool selections.
  const conversion = {
    ...before,
    capabilities: undefined,
    integrations:
      before.integrations?.version === 2 ? undefined : before.integrations,
    scope: "project" as const,
  };
  const context = {
    ...releasedContext(before),
    inheritedSettings:
      before.agent === undefined
        ? {}
        : agentPreferencesSchema.parse(before.agent).overrides,
  };
  const result = convertPreferencesV037(conversion, context);
  if (before.capabilities) {
    const contribution =
      before.capabilities.schemaVersion === 3
        ? projectCapabilitiesSchema.parse(before.capabilities).overrides
        : convertCapabilitiesV037(before.capabilities);
    result.agent.overrides = applySettingsMutation(result.agent.overrides, {
      expectedRevision: 0,
      expectedDigest: "missing",
      changes: {},
      resets: canonicalSettingsEntries(contribution).map(
        ([pointer]) => `/overrides${pointer}`,
      ),
    });
  }
  if (before.subagents) {
    const catalog = z
      .object({
        schemaVersion: z.literal(1),
        profiles: z.record(z.string(), z.record(z.string(), z.unknown())),
      })
      .strict()
      .parse(legacySubagentCatalog(before.subagents));
    const launches = Object.fromEntries(
      Object.entries(catalog.profiles).map(([name, entry]) => [
        name,
        Object.fromEntries(
          Object.entries(entry).filter(([key]) =>
            ["enabled", "model", "thinking"].includes(key),
          ),
        ),
      ]),
    );
    result.agent.overrides = merge(result.agent.overrides, {
      subagents: splitCatalogV037(
        { schemaVersion: 1, profiles: launches },
        "project",
        context,
      ).launches,
    });
  }
  return result;
}
const sources = (part: "agent" | "creation") =>
  (part === "creation"
    ? scopeLegacyInputs.filter((input) => input.path === "config/harness.json")
    : scopeLegacyInputs
  ).map((input) => ({
    ...input,
    inputs:
      part === "creation"
        ? scopeLegacyInputs.filter(
            (input) => input.path === "config/harness.json",
          )
        : [
            ...scopeLegacyInputs,
            {
              root: "home" as const,
              path: "config/agent.json",
              currentVersion: 1,
              version: { field: "schemaVersion", absent: 1 },
            },
          ],
    migrate: (_value: unknown, inputs: Readonly<Record<string, unknown>>) =>
      migrateScopedInputs(inputs)[part],
  }));
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
  legacySources: sources("agent"),
  schema: agentPreferencesSchema,
  fallback: () => ({ schemaVersion: 1, revision: 0, overrides: {} }),
  reset: () => null,
  trustKind: "project_capabilities",
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
  legacySources: sources("creation"),
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
  migrationDependencies: [projectAgentConfiguration],
  migrators: {
    1: (value) =>
      convertPreferencesV037(
        { integrations: value, scope: "project" },
        releasedContext({}),
      ).integrations,
  },
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
  trustKind: "agent_profile",
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
  migrators: {
    2: (value) => ({
      schemaVersion: 3,
      overrides: convertCapabilitiesV037(value),
    }),
  },
  schema: projectCapabilitiesSchema,
  fallback: () => ({ schemaVersion: 3, overrides: {} }),
  reset: () => null,
  trustKind: "project_capabilities",
};
