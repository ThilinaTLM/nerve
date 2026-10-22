import { z } from "zod";
import { subagentToolNames, isSubagentTool } from "../tools/subagent-tools.js";
import {
  imageExplanationToolSettingsSchema,
  imageGenerationToolSettingsSchema,
  krokiToolSettingsSchema,
  pythonExecToolSettingsSchema,
  bashToolSettingsSchema,
  planPresentToolSettingsSchema,
  type Settings,
} from "../settings/settings.js";
import {
  userConfigurableToolNameSchema,
  type UserConfigurableToolName,
} from "../tools/tool-name.js";

/** Optional tools toggle; bash is always on but has scoped configuration. */
export const capabilityToggleToolNameSchema = z.enum([
  ...userConfigurableToolNameSchema.exclude(subagentToolNames).options,
  "subagents",
  "jira",
  "confluence",
]);
export const capabilityToolNameSchema = z.enum([
  ...capabilityToggleToolNameSchema.options,
  "bash",
]);
export type CapabilityToolName = z.infer<typeof capabilityToolNameSchema>;
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
export const capabilityToolSettingsSchema = z
  .object({
    python_exec: pythonExecToolSettingsSchema,
    bash: bashToolSettingsSchema,
    plan_present: planPresentToolSettingsSchema,
    explain_image: imageExplanationToolSettingsSchema,
    generate_image: imageGenerationToolSettingsSchema,
    kroki_export: krokiToolSettingsSchema,
  })
  .strict();
export type CapabilityToolSettings = z.infer<
  typeof capabilityToolSettingsSchema
>;
export type ConfigurableCapabilityToolName = keyof CapabilityToolSettings;
export const configurableCapabilityToolNames = Object.keys(
  capabilityToolSettingsSchema.shape,
) as ConfigurableCapabilityToolName[];
export function isConfigurableCapabilityTool(
  name: string,
): name is ConfigurableCapabilityToolName {
  return (configurableCapabilityToolNames as readonly string[]).includes(name);
}
export function capabilityToolSettingsFromSettings(
  settings: Pick<Settings, "tools">,
): CapabilityToolSettings {
  return capabilityToolSettingsSchema.parse(
    JSON.parse(
      JSON.stringify({
        python_exec: settings.tools.pythonExec,
        bash: settings.tools.bash,
        plan_present: settings.tools.planPresent,
        explain_image: settings.tools.imageExplanation,
        generate_image: settings.tools.imageGeneration,
        kroki_export: settings.tools.kroki,
      }),
    ),
  );
}
const profileIdSchema = z.string().trim().min(1).max(256);
const skillNameSchema = z.string().trim().min(1).max(256);
const skillOverridesSchema = z
  .record(skillNameSchema, z.boolean())
  .refine(
    (value) => Object.keys(value).length <= 512,
    "At most 512 skill overrides are allowed.",
  );
export const capabilitySkillsSchema = z
  .object({
    file: skillOverridesSchema,
    nerve: skillOverridesSchema,
    agentBrowser: skillOverridesSchema,
  })
  .strict();
export type CapabilitySkills = z.infer<typeof capabilitySkillsSchema>;
function payload<S extends z.ZodType>(settings: S) {
  return z
    .object({ enabled: z.boolean().optional(), settings: settings.optional() })
    .strict();
}
const basicPayload = payload(z.never());
const accountPayload = z
  .object({
    enabled: z.boolean().optional(),
    profileId: profileIdSchema.optional(),
  })
  .strict();
/** Canonical per-tool payloads shared by capability files and profile templates. */
export const capabilityToolPayloadSchemas = {
  python_exec: payload(pythonExecToolSettingsSchema),
  web_search: accountPayload,
  web_fetch: basicPayload,
  explain_image: payload(imageExplanationToolSettingsSchema),
  generate_image: payload(imageGenerationToolSettingsSchema),
  kroki_export: payload(krokiToolSettingsSchema),
  plan_present: payload(planPresentToolSettingsSchema),
  subagents: basicPayload,
  jira: accountPayload,
  confluence: accountPayload,
  bash: z.object({ settings: bashToolSettingsSchema }).strict(),
};
export type CapabilityToolPayloads = {
  [K in keyof typeof capabilityToolPayloadSchemas]: z.infer<
    (typeof capabilityToolPayloadSchemas)[K]
  >;
};
export type CapabilityToolOverride =
  CapabilityToolPayloads[keyof CapabilityToolPayloads];
export const capabilityToolsSchema = z
  .object(capabilityToolPayloadSchemas)
  .partial()
  .strict()
  .superRefine((tools, ctx) => {
    for (const [name, value] of Object.entries(tools))
      if (value && Object.keys(value).length === 0)
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "A tool entry must set enabled, profileId or settings.",
        });
  });
export const capabilityToolOverrideSchema = z.union([
  basicPayload,
  accountPayload,
  ...Object.values(capabilityToolPayloadSchemas),
]);
export const capabilityOverridesDocumentSchema = z
  .object({
    schemaVersion: z.literal(3),
    tools: capabilityToolsSchema.default({}),
    skills: capabilitySkillsSchema.default({
      file: {},
      nerve: {},
      agentBrowser: {},
    }),
  })
  .strict();
export type CapabilityOverridesDocument = z.infer<
  typeof capabilityOverridesDocumentSchema
>;
export const emptyCapabilityOverrides = (): CapabilityOverridesDocument => ({
  schemaVersion: 3,
  tools: {},
  skills: { file: {}, nerve: {}, agentBrowser: {} },
});
export const capabilityOriginSchema = z.enum(["project", "conversation"]);
export type CapabilityOrigin = z.infer<typeof capabilityOriginSchema>;
/** Null resets a whole tool entry or one typed payload field to inherited settings. */
function payloadPatch<S extends Record<string, z.ZodType>>(
  schema: z.ZodObject<S>,
) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([field, value]) => [
      field,
      value.nullable().optional(),
    ]),
  ) as { [K in keyof S]: z.ZodOptional<z.ZodNullable<S[K]>> };
  return z.object(shape).strict();
}
export const capabilityToolPatchSchemas = {
  python_exec: payloadPatch(capabilityToolPayloadSchemas.python_exec),
  web_search: payloadPatch(capabilityToolPayloadSchemas.web_search),
  web_fetch: payloadPatch(capabilityToolPayloadSchemas.web_fetch),
  explain_image: payloadPatch(capabilityToolPayloadSchemas.explain_image),
  generate_image: payloadPatch(capabilityToolPayloadSchemas.generate_image),
  kroki_export: payloadPatch(capabilityToolPayloadSchemas.kroki_export),
  plan_present: payloadPatch(capabilityToolPayloadSchemas.plan_present),
  subagents: payloadPatch(capabilityToolPayloadSchemas.subagents),
  jira: payloadPatch(capabilityToolPayloadSchemas.jira),
  confluence: payloadPatch(capabilityToolPayloadSchemas.confluence),
  bash: payloadPatch(capabilityToolPayloadSchemas.bash),
};
export const capabilityToolPatchSchema = z.union(
  Object.values(capabilityToolPatchSchemas),
);
export type CapabilityToolPatch = z.infer<typeof capabilityToolPatchSchema>;
export const capabilityPatchSchema = z
  .object({
    tools: z
      .object({
        python_exec: capabilityToolPatchSchemas.python_exec
          .nullable()
          .optional(),
        web_search: capabilityToolPatchSchemas.web_search.nullable().optional(),
        web_fetch: capabilityToolPatchSchemas.web_fetch.nullable().optional(),
        explain_image: capabilityToolPatchSchemas.explain_image
          .nullable()
          .optional(),
        generate_image: capabilityToolPatchSchemas.generate_image
          .nullable()
          .optional(),
        kroki_export: capabilityToolPatchSchemas.kroki_export
          .nullable()
          .optional(),
        plan_present: capabilityToolPatchSchemas.plan_present
          .nullable()
          .optional(),
        subagents: capabilityToolPatchSchemas.subagents.nullable().optional(),
        jira: capabilityToolPatchSchemas.jira.nullable().optional(),
        confluence: capabilityToolPatchSchemas.confluence.nullable().optional(),
        bash: capabilityToolPatchSchemas.bash.nullable().optional(),
      })
      .strict()
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
  disabledTools: z.array(capabilityToggleToolNameSchema),
  toolProfiles: capabilityToolProfilesSchema,
  toolSettings: capabilityToolSettingsSchema,
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

export function capabilityToolEnabled(
  selection: CapabilitySelection,
  name: CapabilityToolName,
): boolean {
  return name === "bash" || !selection.disabledTools.includes(name);
}
/** A resolved canonical payload, suitable for a template value or an applied lock. */
export function capabilityToolPayload(
  selection: CapabilitySelection,
  name: CapabilityToolName,
): CapabilityToolOverride {
  return capabilityToolPayloadSchemas[name].parse({
    ...(name !== "bash"
      ? { enabled: capabilityToolEnabled(selection, name) }
      : {}),
    ...(isProfiledCapabilityTool(name) && selection.toolProfiles[name]
      ? { profileId: selection.toolProfiles[name] }
      : {}),
    ...(isConfigurableCapabilityTool(name)
      ? { settings: selection.toolSettings[name] }
      : {}),
  });
}
export function applyCapabilityPatch(
  document: CapabilityOverridesDocument,
  patch: CapabilityPatch,
  inherited: CapabilitySelection,
): CapabilityOverridesDocument {
  capabilityPatchSchema.parse(patch);
  const next = structuredClone(document);
  for (const [key, change] of Object.entries(patch.tools ?? {})) {
    const name = key as CapabilityToolName;
    if (change === null) {
      delete next.tools[name];
      continue;
    }
    if (!change) continue;
    const parent = capabilityToolPayload(inherited, name) as Record<
      string,
      unknown
    >;
    const entry = { ...parent, ...next.tools[name] } as Record<string, unknown>;
    for (const [field, value] of Object.entries(change)) {
      if (value === undefined) continue;
      if (value === null) {
        if (parent[field] === undefined) delete entry[field];
        else entry[field] = parent[field];
      } else entry[field] = value;
    }
    Object.assign(next.tools, {
      [name]: capabilityToolPayloadSchemas[name].parse(entry),
    });
  }
  for (const kind of ["file", "nerve", "agentBrowser"] as const) {
    for (const [name, value] of Object.entries(patch.skills?.[kind] ?? {})) {
      if (value === null) delete next.skills[kind][name];
      else next.skills[kind][name] = value;
    }
  }
  return normalizeCapabilityOverrides(next, inherited);
}
export function normalizeCapabilityOverrides(
  document: CapabilityOverridesDocument,
  inherited: CapabilitySelection,
): CapabilityOverridesDocument {
  const effective = resolveCapabilitySelection({
    user: inherited,
    conversation: document,
  });
  const next = emptyCapabilityOverrides();
  for (const key of Object.keys(document.tools)) {
    const name = key as CapabilityToolName;
    const payload = capabilityToolPayload(effective, name);
    if (!sameSettings(payload, capabilityToolPayload(inherited, name)))
      Object.assign(next.tools, { [name]: payload });
  }
  for (const kind of ["file", "nerve", "agentBrowser"] as const) {
    for (const [name, enabled] of Object.entries(document.skills[kind])) {
      const parent =
        kind === "file"
          ? !inherited.disabledFileSkills.includes(name)
          : kind === "nerve"
            ? inherited.enabledNerveSkills.includes(name)
            : inherited.enabledAgentBrowserSkills.includes(name);
      if (enabled !== parent) next.skills[kind][name] = enabled;
    }
  }
  return capabilityOverridesDocumentSchema.parse(next);
}
export function resolveCapabilitySelection(input: {
  user: CapabilitySelection;
  project?: CapabilityOverridesDocument;
  conversation?: CapabilityOverridesDocument;
}): CapabilitySelection {
  const result = structuredClone(input.user);
  const disabled = new Set(result.disabledTools);
  for (const document of [input.project, input.conversation]) {
    if (!document) continue;
    capabilityOverridesDocumentSchema.parse(document);
    for (const [key, value] of Object.entries(document.tools)) {
      const name = key as CapabilityToolName;
      const override = value as {
        enabled?: boolean;
        profileId?: string;
        settings?: unknown;
      };
      if (name !== "bash" && override.enabled === true) disabled.delete(name);
      if (name !== "bash" && override.enabled === false) disabled.add(name);
      if (isProfiledCapabilityTool(name) && override.profileId !== undefined)
        result.toolProfiles[name] = override.profileId;
      if (isConfigurableCapabilityTool(name) && override.settings !== undefined)
        Object.assign(result.toolSettings, { [name]: override.settings });
    }
    const buckets = {
      file: new Set(result.disabledFileSkills),
      nerve: new Set(result.enabledNerveSkills),
      agentBrowser: new Set(result.enabledAgentBrowserSkills),
    };
    for (const kind of ["file", "nerve", "agentBrowser"] as const)
      for (const [name, enabled] of Object.entries(document.skills[kind])) {
        if (kind === "file" ? !enabled : enabled) buckets[kind].add(name);
        else buckets[kind].delete(name);
      }
    result.disabledFileSkills = [...buckets.file];
    result.enabledNerveSkills = [...buckets.nerve];
    result.enabledAgentBrowserSkills = [...buckets.agentBrowser];
  }
  result.disabledTools = [...disabled];
  return capabilitySelectionSchema.parse(result);
}
/**
 * Whether two tool settings values are equal, independent of key order. Works
 * for a whole resolved `CapabilityToolSettings` or one tool's settings.
 */
export function sameCapabilityToolSettings<T>(left: T, right: T): boolean {
  return sameSettings(left, right);
}

/** Structural equality for JSON settings values, independent of key order. */
function sameSettings(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
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
        (typeof subagentToolNames)[number]
      > => !isSubagentTool(name),
    ),
    ...(names.some(isSubagentTool) ? ["subagents" as const] : []),
  ];
}

/** Expand groups only at the harness tool-advertisement boundary. */
export function disabledToolNamesForCapabilities(
  names: readonly CapabilityToolName[],
): UserConfigurableToolName[] {
  return names.flatMap((name) =>
    name === "subagents"
      ? [...subagentToolNames]
      : name === "jira" || name === "confluence" || name === "bash"
        ? []
        : [name],
  );
}
