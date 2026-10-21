import { z } from "zod";
import { agentProfileRecordSchema } from "./record-schema.js";
import { capabilityToolNameSchema } from "../capabilities/capabilities.js";
import { agentProfileNameSchema } from "./constants.js";
import {
  builtInAgentProfiles,
  agentProfileDraftSchema,
  agentProfileSchema,
  agentProfileScopeSchema,
  agentProfileSourceSchema,
  agentProfileTrustSchema,
  type AgentProfile,
  type AgentProfileSource,
  type AgentProfileScope,
} from "./agent-profile.js";

/** Persisted entries are sparse. Presence pins a value, even if it equals inheritance. */
export const agentProfileEntrySchema = agentProfileDraftSchema
  .omit({ name: true })
  .partial();
export type AgentProfileEntry = z.infer<typeof agentProfileEntrySchema>;
export const agentProfilesDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    profiles: agentProfileRecordSchema(
      agentProfileNameSchema,
      agentProfileEntrySchema,
    ),
  })
  .strict();
export type AgentProfilesDocument = z.infer<typeof agentProfilesDocumentSchema>;

const fields = agentProfileEntrySchema.shape;
const patchFields = {
  label: fields.label.nullable(),
  description: fields.description.nullable(),
  enabled: fields.enabled.nullable(),
  usableBy: fields.usableBy.nullable(),
  model: fields.model.nullable(),
  thinking: fields.thinking.nullable(),
  instructions: fields.instructions.nullable(),
  permission: fields.permission.nullable(),
  compaction: fields.compaction.nullable(),
};
/** Null deletes a field; null map members delete only that local selection. */
export const agentProfilePatchSchema = z
  .object(patchFields)
  .extend({
    tools: agentProfileRecordSchema(
      z.string().min(1).max(64),
      z.union([
        z.boolean(),
        agentProfileRecordSchema(z.string(), z.unknown()),
        z.null(),
      ]),
    )
      .nullable()
      .optional(),
    skills: z
      .union([
        z.literal("inherit"),
        z.literal("none"),
        agentProfileRecordSchema(
          z.string().trim().min(1).max(256),
          z.boolean().nullable(),
        ),
      ])
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    const entry = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== null),
    );
    for (const key of ["tools", "skills"] as const) {
      if (entry[key] && typeof entry[key] === "object")
        entry[key] = Object.fromEntries(
          Object.entries(entry[key]).filter(([, value]) => value !== null),
        );
    }
    const parsed = agentProfileEntrySchema.safeParse(entry);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export type AgentProfilePatch = z.infer<typeof agentProfilePatchSchema>;

function setOwn(
  record: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function applyAgentProfilePatch(
  document: AgentProfilesDocument,
  name: string,
  patch: AgentProfilePatch | null,
): AgentProfilesDocument {
  agentProfileNameSchema.parse(name);
  const profiles = {
    ...agentProfilesDocumentSchema.parse(document).profiles,
  };
  if (patch === null) delete profiles[name];
  else {
    agentProfilePatchSchema.parse(patch);
    const entry: Record<string, unknown> = Object.hasOwn(profiles, name)
      ? { ...profiles[name] }
      : {};
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (value === null) {
        delete entry[field];
        continue;
      }
      if (
        (field === "tools" || field === "skills") &&
        typeof value === "object"
      ) {
        const selections: Record<string, unknown> =
          typeof entry[field] === "object"
            ? { ...(entry[field] as Record<string, unknown>) }
            : {};
        for (const [key, selected] of Object.entries(value)) {
          if (selected === null) delete selections[key];
          else setOwn(selections, key, selected);
        }
        entry[field] = selections;
      } else entry[field] = value;
    }
    setOwn(profiles, name, agentProfileEntrySchema.parse(entry));
  }
  return { schemaVersion: 1, profiles };
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
    fields: agentProfileRecordSchema(z.string(), agentProfileSourceSchema),
    tools: agentProfileRecordSchema(z.string(), agentProfileSourceSchema),
    skills: agentProfileRecordSchema(z.string(), agentProfileSourceSchema),
  })
  .strict();
export const agentProfileConfigurationSchema = z
  .object({
    name: agentProfileNameSchema,
    local: agentProfileEntrySchema.nullable(),
    inherited: agentProfileEntrySchema.nullable(),
    effective: agentProfileSchema.nullable(),
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
    document: agentProfilesDocumentSchema.nullable(),
    digest: z.string().min(1).nullable(),
    trust: agentProfileTrustSchema,
    diagnostics: z.array(agentProfileDiagnosticSchema),
    profiles: z.array(agentProfileConfigurationSchema),
  })
  .strict();
export type AgentProfilesConfiguration = z.infer<
  typeof agentProfilesConfigurationSchema
>;

/** Host reads raw JSON without losing invalid entries; read/JSON errors go in error. */
export interface AgentProfileLayer {
  source: AgentProfileScope;
  document?: unknown;
  digest?: string;
  path?: string;
  trust?: "trusted" | "untrusted";
  error?: string;
}
export interface ResolveAgentProfilesOptions {
  layers: readonly AgentProfileLayer[];
  scope?: AgentProfileScope;
  /** Availability checks are host-owned; never mutate or delete portable references. */
  diagnostics?: (profile: AgentProfile) => readonly AgentProfileDiagnostic[];
}

function mergeEntry(
  lower: AgentProfileEntry,
  upper: AgentProfileEntry,
): AgentProfileEntry {
  return {
    ...lower,
    ...upper,
    ...(upper.tools ? { tools: { ...lower.tools, ...upper.tools } } : {}),
    ...(upper.skills &&
    typeof upper.skills === "object" &&
    typeof lower.skills === "object"
      ? { skills: { ...lower.skills, ...upper.skills } }
      : {}),
  };
}

/** Always resolves builtin → user → project → conversation, regardless of input order. */
export function resolveAgentProfiles(
  options: ResolveAgentProfilesOptions,
): AgentProfilesConfiguration {
  const scope = options.scope ?? "conversation";
  const order: AgentProfileScope[] = ["user", "project", "conversation"];
  const layers = order
    .slice(0, order.indexOf(scope) + 1)
    .map((source) => options.layers.find((layer) => layer.source === source))
    .filter((layer): layer is AgentProfileLayer => !!layer);
  const documentErrors: AgentProfileDiagnostic[] = [];
  const decoded = layers.map((layer) => {
    const envelope = z
      .object({
        schemaVersion: z.literal(1),
        profiles: agentProfileRecordSchema(agentProfileNameSchema, z.unknown()),
      })
      .strict()
      .safeParse(
        layer.document === undefined
          ? { schemaVersion: 1, profiles: {} }
          : layer.document,
      );
    const error =
      layer.error ?? (!envelope.success ? envelope.error.message : undefined);
    if (error)
      documentErrors.push({
        severity: "blocking",
        code: "invalid_document",
        source: layer.source,
        message: error,
      });
    return {
      layer,
      entries: !error && envelope.success ? envelope.data.profiles : {},
      error,
    };
  });
  const names = new Set([
    ...builtInAgentProfiles.map((profile) => profile.name),
    ...decoded.flatMap(({ entries }) => Object.keys(entries)),
  ]);
  const profiles: AgentProfileConfiguration[] = [];
  for (const name of names) {
    const builtin = builtInAgentProfiles.find(
      (profile) => profile.name === name,
    );
    let merged: AgentProfileEntry = builtin
      ? agentProfileEntrySchema.parse(
          Object.fromEntries(
            Object.entries(builtin).filter(([key]) => key !== "name"),
          ),
        )
      : {};
    const origins: AgentProfileConfiguration["origins"] = {
      fields: {},
      tools: {},
      skills: {},
    };
    if (builtin)
      for (const field of Object.keys(merged))
        setOwn(origins.fields, field, "builtin");
    let source: AgentProfileSource = "builtin";
    let inherited: AgentProfileEntry | null = null;
    let local: AgentProfileEntry | null = null;
    let trust: "trusted" | "untrusted" = "trusted";
    let path: string | undefined;
    let digest: string | undefined;
    const diagnostics = [...documentErrors];
    for (const { layer, entries } of decoded) {
      if (layer.source === scope)
        inherited = Object.keys(merged).length ? { ...merged } : null;
      if (!Object.hasOwn(entries, name)) continue;
      source = layer.source;
      path = layer.path;
      digest = layer.digest;
      const parsed = agentProfileEntrySchema.safeParse(entries[name]);
      if (!parsed.success) {
        diagnostics.push({
          severity: "blocking",
          code: "invalid_entry",
          source,
          message: parsed.error.message,
        });
        continue;
      }
      const entry = parsed.data;
      if (layer.source === scope) local = entry;
      if (layer.source === "project" && layer.trust === "untrusted") {
        trust = "untrusted";
        diagnostics.push({
          severity: "blocking",
          code: "untrusted_project",
          source,
          message:
            "Trust the current project agent-profiles.json before using this profile.",
        });
      }
      const previousSkills = merged.skills;
      merged = mergeEntry(merged, entry);
      for (const field of Object.keys(entry))
        setOwn(origins.fields, field, source);
      for (const tool of Object.keys(entry.tools ?? {}))
        setOwn(origins.tools, tool, source);
      if (entry.skills !== undefined) {
        if (
          typeof entry.skills !== "object" ||
          typeof previousSkills !== "object"
        )
          origins.skills = {};
        if (typeof entry.skills === "object")
          for (const skill of Object.keys(entry.skills))
            setOwn(origins.skills, skill, source);
      }
    }
    if (!layers.some((layer) => layer.source === scope))
      inherited = Object.keys(merged).length ? { ...merged } : null;
    const complete = agentProfileDraftSchema.safeParse({ name, ...merged });
    let effective: AgentProfile | null = null;
    if (!complete.success)
      diagnostics.push({
        severity: "blocking",
        code: "incomplete_profile",
        message: complete.error.message,
      });
    else {
      effective = {
        ...complete.data,
        label: complete.data.label ?? name,
        enabled: complete.data.enabled ?? true,
        tools: complete.data.tools ?? {},
        source,
        trust,
        ...(path ? { path } : {}),
        ...(digest ? { digest } : {}),
      };
      for (const [tool, selection] of Object.entries(effective.tools)) {
        if (
          selection !== false &&
          !capabilityToolNameSchema.safeParse(tool).success
        )
          diagnostics.push({
            severity: "warning",
            code: "unknown_tool",
            field: "tools",
            reference: tool,
            message: `Tool ${tool} is unknown to this application version and will not be enabled.`,
          });
      }
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
      origins,
      trust,
      diagnostics,
    });
  }
  const target = layers.find((layer) => layer.source === scope);
  const parsedDocument = agentProfilesDocumentSchema.safeParse(
    target?.document === undefined
      ? { schemaVersion: 1, profiles: {} }
      : target.document,
  );
  return {
    scope,
    document:
      !target?.error && parsedDocument.success ? parsedDocument.data : null,
    digest: target?.digest ?? null,
    trust: target?.trust ?? "trusted",
    diagnostics: documentErrors,
    profiles,
  };
}
