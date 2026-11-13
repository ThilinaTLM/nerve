import { z } from "zod";
import {
  agentPreferencesSchema,
  conversationDefaultsSchema,
  leadSettingsOverridesSchema,
} from "@nervekit/contracts/agent-configuration";
import type { AgentDocument, AgentScope } from "../document-adapters.js";
import type { ProjectConfigurationType } from "../../project-migration/project-migration.js";
import { legacySubagentCatalog } from "./frozen/subagent-catalog.js";
import { migrateCapabilitiesV2 } from "./frozen/single-file-versions.js";
import {
  dropMovedFromOverrides,
  movedKeysNotice,
  withoutMovedToolKeys,
} from "./frozen/moved-extension-keys.js";

/**
 * The project file's own version (`version`) is independent of the DTO
 * `schemaVersion: 1`; the store reads documents without it.
 */
export type ProjectAgentDocument = z.infer<typeof agentPreferencesSchema> & {
  version: 2;
};
const withoutVersion = (value: unknown): unknown =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "version"),
      )
    : value;
export const projectAgentSchema = {
  parse(value: unknown): ProjectAgentDocument {
    const { version } = z
      .object({ version: z.literal(2) })
      .passthrough()
      .parse(value);
    return { ...agentPreferencesSchema.parse(withoutVersion(value)), version };
  },
};
export function projectAgentDocumentValue(
  value: unknown,
): z.infer<typeof agentPreferencesSchema> {
  return agentPreferencesSchema.parse(withoutVersion(value));
}
/** Project agent files carry their own chain `version`; documents do not. */
export const projectAgentDisk = {
  fromDisk: (input: unknown, scope: AgentScope): unknown =>
    scope.scope === "project" ? withoutVersion(input) : input,
  toDisk: (document: AgentDocument, scope: AgentScope): unknown =>
    scope.scope === "project" ? { ...document, version: 2 } : document,
};
export const projectAgentConfiguration: ProjectConfigurationType<ProjectAgentDocument> =
  {
    id: "agent-settings",
    label: "Project agent settings",
    resetDescription:
      "Remove this override file; lower-precedence agent settings will apply.",
    fallbackDescription:
      "Lower-precedence agent settings apply while this override is unavailable.",
    path: "config/agent.json",
    currentVersion: 2,
    version: { field: "version", absent: 1 },
    migrators: {
      1: (value) => ({
        ...(dropMovedFromOverrides(value).value as object),
        version: 2,
      }),
    },
    upgradeNotice: (original) =>
      dropMovedFromOverrides(original).dropped.length
        ? movedKeysNotice
        : undefined,
    legacyFiles: ["config/harness.json", "config/integrations.json"],
    schema: projectAgentSchema,
    fallback: () => ({
      version: 2,
      schemaVersion: 1,
      revision: 0,
      overrides: {},
    }),
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
    schemaVersion: z.literal(4),
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
  currentVersion: 4,
  version: { field: "schemaVersion", absent: 2 },
  migrators: {
    2: migrateCapabilitiesV2,
    3: (value) => ({
      ...(dropMovedFromOverrides(value).value as object),
      schemaVersion: 4,
    }),
  },
  upgradeNotice: (original) => {
    // v2 files keep `tools` at the root, v3 under `overrides`.
    const root = (original as { tools?: Record<string, unknown> } | null)
      ?.tools;
    return dropMovedFromOverrides(original).dropped.length ||
      (root && withoutMovedToolKeys(root).dropped.length)
      ? movedKeysNotice
      : undefined;
  },
  schema: projectCapabilitiesSchema,
  fallback: () => ({ schemaVersion: 4, overrides: {} }),
  reset: () => null,
};
