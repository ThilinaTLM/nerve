import { z } from "zod";
import {
  asyncSubagentToolNames,
  isAsyncSubagentTool,
} from "../agents/async-subagents.js";
import {
  userConfigurableToolNameSchema,
  type UserConfigurableToolName,
} from "../tools/tool-name.js";

/**
 * Tools that can be configured per project or conversation. Integration
 * families are selected as a whole; their credentials stay user-owned.
 */
export const capabilityToolNameSchema = z.enum([
  ...userConfigurableToolNameSchema.exclude(asyncSubagentToolNames).options,
  "subagents",
  "jira",
  "confluence",
]);
export type CapabilityToolName = z.infer<typeof capabilityToolNameSchema>;

/** Capability tools whose execution depends on a selectable integration profile. */
export const profiledCapabilityToolNames = [
  "jira",
  "confluence",
  "web_search",
] as const;
export const profiledCapabilityToolNameSchema = z.enum(
  profiledCapabilityToolNames,
);
export type ProfiledCapabilityToolName = z.infer<
  typeof profiledCapabilityToolNameSchema
>;

export function isProfiledCapabilityTool(
  name: string,
): name is ProfiledCapabilityToolName {
  return (profiledCapabilityToolNames as readonly string[]).includes(name);
}

const skillNameSchema = z.string().trim().min(1).max(256);
const profileIdSchema = z.string().trim().min(1).max(256);
const skillOverridesSchema = z
  .record(skillNameSchema, z.boolean())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 512)
      context.addIssue({
        code: "custom",
        message: "At most 512 skill overrides are allowed.",
      });
  });

/** Sparse per-tool override: each absent field inherits from the parent level. */
export const capabilityToolOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    profileId: profileIdSchema.optional(),
  })
  .strict();
export type CapabilityToolOverride = z.infer<
  typeof capabilityToolOverrideSchema
>;

const toolOverridesSchema = z
  .partialRecord(capabilityToolNameSchema, capabilityToolOverrideSchema)
  .superRefine((tools, context) => {
    for (const [name, override] of Object.entries(tools)) {
      if (!override) continue;
      if (override.enabled === undefined && override.profileId === undefined)
        context.addIssue({
          code: "custom",
          path: [name],
          message: "A tool override must set enabled or profileId.",
        });
      if (override.profileId !== undefined && !isProfiledCapabilityTool(name))
        context.addIssue({
          code: "custom",
          path: [name, "profileId"],
          message: `Tool ${name} does not use an integration profile.`,
        });
    }
  });

export const capabilityOverridesDocumentSchema = z.preprocess(
  migrateCapabilityDocument,
  z
    .object({
      schemaVersion: z.literal(2),
      tools: toolOverridesSchema.default({}),
      skills: z
        .object({
          file: skillOverridesSchema.default({}),
          nerve: skillOverridesSchema.default({}),
          agentBrowser: skillOverridesSchema.default({}),
        })
        .strict()
        .default({ file: {}, nerve: {}, agentBrowser: {} }),
    })
    .strict(),
);
export type CapabilityOverridesDocument = z.infer<
  typeof capabilityOverridesDocumentSchema
>;

export const emptyCapabilityOverrides = (): CapabilityOverridesDocument => ({
  schemaVersion: 2,
  tools: {},
  skills: { file: {}, nerve: {}, agentBrowser: {} },
});

export const capabilityOriginSchema = z.enum(["project", "conversation"]);
export type CapabilityOrigin = z.infer<typeof capabilityOriginSchema>;

const capabilityToolPatchSchema = z
  .object({
    enabled: z.boolean().nullable().optional(),
    profileId: profileIdSchema.nullable().optional(),
  })
  .strict();
export type CapabilityToolPatch = z.infer<typeof capabilityToolPatchSchema>;

export const capabilityPatchSchema = z
  .object({
    tools: z
      .partialRecord(capabilityToolNameSchema, capabilityToolPatchSchema)
      .optional(),
    skills: z
      .object({
        file: z.record(skillNameSchema, z.boolean().nullable()).optional(),
        nerve: z.record(skillNameSchema, z.boolean().nullable()).optional(),
        agentBrowser: z
          .record(skillNameSchema, z.boolean().nullable())
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CapabilityPatch = z.infer<typeof capabilityPatchSchema>;

export const capabilityTrustSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("invalid"), reason: z.string() }),
  z.object({
    status: z.literal("untrusted"),
    digest: z.string(),
    trustedDigest: z.string().optional(),
    trustedAt: z.string().datetime().optional(),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("trusted"),
    digest: z.string(),
    trustedDigest: z.string(),
    trustedAt: z.string().datetime(),
  }),
]);
export type CapabilityTrust = z.infer<typeof capabilityTrustSchema>;

export const capabilityToolProfilesSchema = z
  .object({
    jira: profileIdSchema.optional(),
    confluence: profileIdSchema.optional(),
    web_search: profileIdSchema.optional(),
  })
  .strict();
export type CapabilityToolProfiles = z.infer<
  typeof capabilityToolProfilesSchema
>;

export const capabilitySelectionSchema = z.object({
  disabledTools: z.array(capabilityToolNameSchema),
  toolProfiles: capabilityToolProfilesSchema,
  disabledFileSkills: z.array(skillNameSchema),
  enabledNerveSkills: z.array(skillNameSchema),
  enabledAgentBrowserSkills: z.array(skillNameSchema),
});
export type CapabilitySelection = z.infer<typeof capabilitySelectionSchema>;

export const capabilityProfileOptionSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1),
  detail: z.string().optional(),
});
export type CapabilityProfileOption = z.infer<
  typeof capabilityProfileOptionSchema
>;

export const capabilityToolProfileOptionsSchema = z.object({
  jira: z.array(capabilityProfileOptionSchema),
  confluence: z.array(capabilityProfileOptionSchema),
  web_search: z.array(capabilityProfileOptionSchema),
});
export type CapabilityToolProfileOptions = z.infer<
  typeof capabilityToolProfileOptionsSchema
>;

export const capabilityConfigurationSchema = z.object({
  project: capabilityOverridesDocumentSchema,
  conversation: capabilityOverridesDocumentSchema.optional(),
  /**
   * Resolution of every level above the one being edited: user settings for
   * project edits, user plus trusted project for conversation edits.
   */
  inherited: capabilitySelectionSchema,
  effective: capabilitySelectionSchema,
  /** Tools this machine can actually offer; unconfigured integrations are omitted. */
  availableTools: z.array(capabilityToolNameSchema),
  /** Profiles that can be selected for each profiled tool on this machine. */
  toolProfileOptions: capabilityToolProfileOptionsSchema,
  trust: capabilityTrustSchema,
  projectDigest: z.string().optional(),
  conversationDigest: z.string().optional(),
});
export type CapabilityConfiguration = z.infer<
  typeof capabilityConfigurationSchema
>;

/** Whether a tool is enabled by a resolved selection. */
export function capabilityToolEnabled(
  selection: CapabilitySelection,
  name: CapabilityToolName,
): boolean {
  return !selection.disabledTools.includes(name);
}

/**
 * Apply a sparse patch to one level. Values that match what the level would
 * inherit are removed, so an override only exists while it is a real choice.
 * Parent changes never touch stored overrides; only edits of this level do.
 */
export function applyCapabilityPatch(
  document: CapabilityOverridesDocument,
  patch: CapabilityPatch,
  inherited: CapabilitySelection,
): CapabilityOverridesDocument {
  const next = structuredClone(document);
  for (const [key, change] of Object.entries(patch.tools ?? {})) {
    if (!change) continue;
    const name = key as CapabilityToolName;
    const entry: CapabilityToolOverride = { ...next.tools[name] };
    if (change.enabled !== undefined) {
      if (
        change.enabled === null ||
        change.enabled === capabilityToolEnabled(inherited, name)
      )
        delete entry.enabled;
      else entry.enabled = change.enabled;
    }
    if (change.profileId !== undefined) {
      const inheritedProfile = isProfiledCapabilityTool(name)
        ? inherited.toolProfiles[name]
        : undefined;
      if (change.profileId === null || change.profileId === inheritedProfile)
        delete entry.profileId;
      else entry.profileId = change.profileId;
    }
    if (entry.enabled === undefined && entry.profileId === undefined)
      delete next.tools[name];
    else next.tools[name] = entry;
  }
  const inheritedSkill = {
    file: (name: string) => !inherited.disabledFileSkills.includes(name),
    nerve: (name: string) => inherited.enabledNerveSkills.includes(name),
    agentBrowser: (name: string) =>
      inherited.enabledAgentBrowserSkills.includes(name),
  };
  for (const kind of ["file", "nerve", "agentBrowser"] as const) {
    for (const [name, value] of Object.entries(patch.skills?.[kind] ?? {})) {
      if (value === null || value === inheritedSkill[kind](name))
        delete next.skills[kind][name];
      else next.skills[kind][name] = value;
    }
  }
  return capabilityOverridesDocumentSchema.parse(next);
}

export function resolveCapabilitySelection(input: {
  user: CapabilitySelection;
  project?: CapabilityOverridesDocument;
  conversation?: CapabilityOverridesDocument;
}): CapabilitySelection {
  const disabledTools = new Set(input.user.disabledTools);
  const toolProfiles: CapabilityToolProfiles = { ...input.user.toolProfiles };
  const disabledFileSkills = new Set(input.user.disabledFileSkills);
  const enabledNerveSkills = new Set(input.user.enabledNerveSkills);
  const enabledAgentBrowserSkills = new Set(
    input.user.enabledAgentBrowserSkills,
  );
  for (const document of [input.project, input.conversation]) {
    if (!document) continue;
    for (const [key, override] of Object.entries(document.tools)) {
      if (!override) continue;
      const name = key as CapabilityToolName;
      if (override.enabled === true) disabledTools.delete(name);
      else if (override.enabled === false) disabledTools.add(name);
      if (override.profileId !== undefined && isProfiledCapabilityTool(name))
        toolProfiles[name] = override.profileId;
    }
    for (const [name, enabled] of Object.entries(document.skills.file)) {
      if (enabled) disabledFileSkills.delete(name);
      else disabledFileSkills.add(name);
    }
    for (const [name, enabled] of Object.entries(document.skills.nerve)) {
      if (enabled) enabledNerveSkills.add(name);
      else enabledNerveSkills.delete(name);
    }
    for (const [name, enabled] of Object.entries(
      document.skills.agentBrowser,
    )) {
      if (enabled) enabledAgentBrowserSkills.add(name);
      else enabledAgentBrowserSkills.delete(name);
    }
  }
  return capabilitySelectionSchema.parse({
    disabledTools: [...disabledTools],
    toolProfiles,
    disabledFileSkills: [...disabledFileSkills],
    enabledNerveSkills: [...enabledNerveSkills],
    enabledAgentBrowserSkills: [...enabledAgentBrowserSkills],
  });
}

/** Collapse concrete tool settings into independently selectable capability groups. */
export function capabilityToolsFromDisabledNames(
  names: readonly UserConfigurableToolName[],
): CapabilityToolName[] {
  return [
    ...names.filter(
      (
        name,
      ): name is Exclude<
        UserConfigurableToolName,
        (typeof asyncSubagentToolNames)[number]
      > => !isAsyncSubagentTool(name),
    ),
    ...(names.some(isAsyncSubagentTool) ? ["subagents" as const] : []),
  ];
}

/** Expand groups only at the harness tool-advertisement boundary. */
export function disabledToolNamesForCapabilities(
  names: readonly CapabilityToolName[],
): UserConfigurableToolName[] {
  return names.flatMap((name) =>
    name === "subagents"
      ? [...asyncSubagentToolNames]
      : name === "jira" || name === "confluence"
        ? []
        : [name],
  );
}

function migrateSubagentOverrides(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const tools = { ...value } as Record<string, unknown>;
  const previous = asyncSubagentToolNames
    .filter((name) => Object.hasOwn(tools, name))
    .map((name) => tools[name]);
  if (!previous.length) return value;
  if (previous.some((enabled) => typeof enabled !== "boolean")) return value;
  if (!Object.hasOwn(tools, "subagents"))
    tools.subagents =
      previous.length === asyncSubagentToolNames.length &&
      previous.every((enabled) => enabled === true);
  for (const name of asyncSubagentToolNames) delete tools[name];
  return tools;
}

/** Version 1 stored tool overrides as booleans; version 2 stores sparse objects. */
function migrateCapabilityDocument(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1) return value;
  const tools = migrateSubagentOverrides(document.tools ?? {});
  if (!tools || typeof tools !== "object" || Array.isArray(tools))
    return { ...document, schemaVersion: 2, tools };
  return {
    ...document,
    schemaVersion: 2,
    tools: Object.fromEntries(
      Object.entries(tools).map(([name, enabled]) => [
        name,
        typeof enabled === "boolean" ? { enabled } : enabled,
      ]),
    ),
  };
}
