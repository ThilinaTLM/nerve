import { z } from "zod";
import {
  agentProfileNameSchema,
  agentProfileInstructionsSchema,
} from "./constants.js";
import {
  agentProfileFieldsSchema,
  agentProfileDraftSchema,
  agentProfileSchema,
  agentProfileScopeSchema,
  agentProfileSourceSchema,
  agentProfileTrustSchema,
  validateProfileLeadSettings,
  type AgentProfile,
  type AgentProfileDraft,
  type AgentProfileScope,
} from "./agent-profile.js";

/** Each local file is a complete template, shadowing the same name from lower catalogs. */
export const agentProfileFileSchema = agentProfileFieldsSchema
  .extend({
    schemaVersion: z.literal(2),
    name: agentProfileNameSchema,
    instructions: agentProfileInstructionsSchema,
  })
  .strict()
  .superRefine(validateProfileLeadSettings);
export type AgentProfileFile = z.infer<typeof agentProfileFileSchema>;
/** Transport-neutral filename validation; pass a basename, not an absolute path. */
export function parseAgentProfileFile(
  value: unknown,
  filename: string,
): AgentProfileFile {
  const file = agentProfileFileSchema.parse(value);
  if (filename !== `${file.name}.json`)
    throw new Error(
      `Profile name ${file.name} must match filename ${filename}`,
    );
  return file;
}
/** In-memory draft collections are not a persisted aggregate document. */
export const agentProfilesDraftSchema = z
  .array(agentProfileDraftSchema)
  .superRefine((profiles, ctx) => {
    const seen = new Set<string>();
    for (const [index, profile] of profiles.entries()) {
      if (seen.has(profile.name))
        ctx.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Duplicate profile name",
        });
      seen.add(profile.name);
    }
  });
export type AgentProfilesDraft = z.infer<typeof agentProfilesDraftSchema>;
const fields = agentProfileFieldsSchema.shape;
const toolFields = fields.tools.unwrap().shape;
const toolPatchFields = Object.fromEntries(
  Object.entries(toolFields).map(([name, schema]) => [
    name,
    schema.nullable().optional(),
  ]),
) as {
  [K in keyof typeof toolFields]: z.ZodOptional<
    z.ZodNullable<(typeof toolFields)[K]>
  >;
};
export const agentProfilePatchSchema = z
  .object({
    label: fields.label.nullable().optional(),
    description: fields.description.optional(),
    enabled: fields.enabled.optional(),
    usableBy: fields.usableBy.optional(),
    instructions: agentProfileInstructionsSchema.optional(),
    model: fields.model.nullable().optional(),
    thinking: fields.thinking.nullable().optional(),
    permission: fields.permission.nullable().optional(),
    compaction: fields.compaction.nullable().optional(),
    skills: fields.skills.nullable().optional(),
    tools: z.object(toolPatchFields).strict().nullable().optional(),
  })
  .strict();
export type AgentProfilePatch = z.infer<typeof agentProfilePatchSchema>;
/** Null removes a template setting (Use settings); tools patch independently by key. */
export function applyAgentProfilePatch(
  profile: AgentProfileDraft,
  patch: AgentProfilePatch,
): AgentProfileDraft {
  agentProfilePatchSchema.parse(patch);
  const next: Record<string, unknown> = structuredClone(profile);
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete next[field];
      continue;
    }
    if (field === "tools") {
      const tools: Record<string, unknown> = { ...profile.tools };
      for (const [name, setting] of Object.entries(value as object)) {
        if (setting === null) delete tools[name];
        else if (setting !== undefined) tools[name] = setting;
      }
      next.tools = tools;
    } else next[field] = value;
  }
  return agentProfileDraftSchema.parse(next);
}
export const agentProfileDiagnosticSchema = z
  .object({
    severity: z.enum(["warning", "blocking"]),
    code: z.string().min(1),
    message: z.string().min(1),
    source: agentProfileSourceSchema.optional(),
    field: z.string().optional(),
    reference: z.string().optional(),
  })
  .strict();
export type AgentProfileDiagnostic = z.infer<
  typeof agentProfileDiagnosticSchema
>;
export const agentProfileOriginsSchema = z
  .object({
    fields: z.record(z.string(), agentProfileSourceSchema),
    tools: z.record(z.string(), agentProfileSourceSchema),
    skills: z.record(z.string(), agentProfileSourceSchema),
  })
  .strict();
export const agentProfileConfigurationSchema = z
  .object({
    name: agentProfileNameSchema,
    local: agentProfileFileSchema.nullable(),
    inherited: agentProfileDraftSchema.nullable(),
    effective: agentProfileSchema.nullable(),
    digest: z.string().min(1).nullable(),
    path: z.string().min(1).optional(),
    origins: agentProfileOriginsSchema,
    trust: agentProfileTrustSchema,
    diagnostics: z.array(agentProfileDiagnosticSchema),
  })
  .strict();
export type AgentProfileConfiguration = z.infer<
  typeof agentProfileConfigurationSchema
>;
export const agentProfilesConfigurationSchema = z
  .object({
    scope: agentProfileScopeSchema,
    diagnostics: z.array(agentProfileDiagnosticSchema),
    profiles: z.array(agentProfileConfigurationSchema),
  })
  .strict();
export type AgentProfilesConfiguration = z.infer<
  typeof agentProfilesConfigurationSchema
>;
/** One layer entry per named file. A malformed file blocks only that name. */
export interface AgentProfileLayer {
  source: AgentProfileScope;
  name: string;
  file?: unknown;
  digest?: string;
  path?: string;
  trust?: "trusted" | "untrusted";
  error?: string;
}
export interface ResolveAgentProfilesOptions {
  builtins: readonly AgentProfileDraft[];
  layers: readonly AgentProfileLayer[];
  scope?: AgentProfileScope;
  diagnostics?: (profile: AgentProfile) => readonly AgentProfileDiagnostic[];
}
export function resolveAgentProfiles(
  options: ResolveAgentProfilesOptions,
): AgentProfilesConfiguration {
  const scope = options.scope ?? "project";
  const builtins = agentProfilesDraftSchema.parse(options.builtins);
  const order: AgentProfileScope[] =
    scope === "user" ? ["user"] : ["user", "project"];
  const layers = order.flatMap((source) =>
    options.layers.filter((layer) => layer.source === source),
  );
  const names = new Set([
    ...builtins.map((profile) => profile.name),
    ...layers.map((layer) => layer.name),
  ]);
  const profiles: AgentProfileConfiguration[] = [];
  for (const name of names) {
    agentProfileNameSchema.parse(name);
    let draft: AgentProfileDraft | null =
      builtins.find((profile) => profile.name === name) ?? null;
    let inherited = draft;
    let local: AgentProfileFile | null = null;
    let source: AgentProfile["source"] = "builtin";
    let trust: "trusted" | "untrusted" = "trusted";
    let digest: string | null = null;
    let path: string | undefined;
    const diagnostics: AgentProfileDiagnostic[] = [];
    for (const layer of layers.filter((layer) => layer.name === name)) {
      if (layer.source === scope) inherited = draft;
      source = layer.source;
      path = layer.path;
      digest = layer.digest ?? null;
      const parsed = agentProfileFileSchema.safeParse(layer.file);
      if (layer.error || !parsed.success || parsed.data.name !== name) {
        diagnostics.push({
          severity: "blocking",
          code: "invalid_file",
          source,
          message:
            layer.error ??
            (parsed.success
              ? "Filename and profile name differ"
              : parsed.error.message),
        });
        draft = null;
        continue;
      }
      diagnostics.length = 0;
      trust = "trusted";
      const definition = agentProfileDraftSchema.parse(
        Object.fromEntries(
          Object.entries(parsed.data).filter(
            ([field]) => field !== "schemaVersion",
          ),
        ),
      );
      draft = definition;
      if (layer.source === scope) local = parsed.data;
      if (layer.source === "project" && layer.trust !== "trusted") {
        trust = "untrusted";
        diagnostics.push({
          severity: "blocking",
          code: "untrusted_project",
          source,
          message: `Trust the current ${name}.json file before applying this profile.`,
        });
      }
    }
    if (!layers.some((layer) => layer.name === name && layer.source === scope))
      inherited = draft;
    const effective: AgentProfile | null = draft
      ? {
          ...draft,
          label: draft.label ?? name,
          enabled: draft.enabled ?? true,
          tools: draft.tools ?? {},
          source,
          trust,
          ...(path ? { path } : {}),
          ...(digest ? { digest } : {}),
        }
      : null;
    if (effective) {
      diagnostics.push(...(options.diagnostics?.(effective) ?? []));
      const blockers = diagnostics.filter(
        (diagnostic) => diagnostic.severity === "blocking",
      );
      if (blockers.length)
        effective.error = blockers
          .map((diagnostic) => diagnostic.message)
          .join("\n");
    }
    profiles.push({
      name,
      local,
      inherited,
      effective,
      digest,
      ...(path ? { path } : {}),
      trust,
      diagnostics,
      origins: {
        fields: Object.fromEntries(
          Object.keys(draft ?? {}).map((key) => [key, source]),
        ),
        tools: Object.fromEntries(
          Object.keys(draft?.tools ?? {}).map((key) => [key, source]),
        ),
        skills: {},
      },
    });
  }
  return { scope, diagnostics: [], profiles };
}
