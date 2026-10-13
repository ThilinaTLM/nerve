import { z } from "zod";
import { subagentRecordSchema } from "./record-schema.js";
import { capabilityToolNameSchema } from "../capabilities/capabilities.js";
import { subagentProfileNameSchema } from "./constants.js";
import {
  builtInSubagentProfiles,
  subagentProfileDraftSchema,
  subagentProfileSchema,
  subagentProfileScopeSchema,
  subagentProfileSourceSchema,
  subagentProfileTrustSchema,
  type SubagentProfile,
  type SubagentProfileSource,
  type SubagentProfileScope,
} from "./subagent-profile.js";

/** Persisted entries are sparse. Presence pins a value, even if it equals inheritance. */
export const subagentProfileEntrySchema = subagentProfileDraftSchema
  .omit({ name: true })
  .partial();
export type SubagentProfileEntry = z.infer<typeof subagentProfileEntrySchema>;
export const subagentProfilesDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    profiles: subagentRecordSchema(
      subagentProfileNameSchema,
      subagentProfileEntrySchema,
    ),
  })
  .strict();
export type SubagentProfilesDocument = z.infer<
  typeof subagentProfilesDocumentSchema
>;

const fields = subagentProfileEntrySchema.shape;
const patchFields = {
  label: fields.label.nullable(),
  description: fields.description.nullable(),
  enabled: fields.enabled.nullable(),
  model: fields.model.nullable(),
  thinking: fields.thinking.nullable(),
  instructions: fields.instructions.nullable(),
  permission: fields.permission.nullable(),
  compaction: fields.compaction.nullable(),
};
/** Null deletes a field; null map members delete only that local selection. */
export const subagentProfilePatchSchema = z
  .object(patchFields)
  .extend({
    tools: subagentRecordSchema(
      z.string().min(1).max(64),
      z.union([
        z.boolean(),
        subagentRecordSchema(z.string(), z.unknown()),
        z.null(),
      ]),
    )
      .nullable()
      .optional(),
    skills: z
      .union([
        z.literal("inherit"),
        z.literal("none"),
        subagentRecordSchema(
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
    const parsed = subagentProfileEntrySchema.safeParse(entry);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export type SubagentProfilePatch = z.infer<typeof subagentProfilePatchSchema>;

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

export function applySubagentProfilePatch(
  document: SubagentProfilesDocument,
  name: string,
  patch: SubagentProfilePatch | null,
): SubagentProfilesDocument {
  subagentProfileNameSchema.parse(name);
  const profiles = {
    ...subagentProfilesDocumentSchema.parse(document).profiles,
  };
  if (patch === null) delete profiles[name];
  else {
    subagentProfilePatchSchema.parse(patch);
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
    setOwn(profiles, name, subagentProfileEntrySchema.parse(entry));
  }
  return { schemaVersion: 1, profiles };
}

export const subagentProfileDiagnosticSchema = z
  .object({
    severity: z.enum(["warning", "blocking"]),
    code: z.string().min(1),
    message: z.string().min(1),
    source: subagentProfileSourceSchema.optional(),
    field: z.string().optional(),
    reference: z.string().optional(),
  })
  .strict();
export type SubagentProfileDiagnostic = z.infer<
  typeof subagentProfileDiagnosticSchema
>;
export const subagentProfileOriginsSchema = z
  .object({
    fields: subagentRecordSchema(z.string(), subagentProfileSourceSchema),
    tools: subagentRecordSchema(z.string(), subagentProfileSourceSchema),
    skills: subagentRecordSchema(z.string(), subagentProfileSourceSchema),
  })
  .strict();
export const subagentProfileConfigurationSchema = z
  .object({
    name: subagentProfileNameSchema,
    local: subagentProfileEntrySchema.nullable(),
    inherited: subagentProfileEntrySchema.nullable(),
    effective: subagentProfileSchema.nullable(),
    origins: subagentProfileOriginsSchema,
    trust: subagentProfileTrustSchema,
    diagnostics: z.array(subagentProfileDiagnosticSchema),
  })
  .strict();
export type SubagentProfileConfiguration = z.infer<
  typeof subagentProfileConfigurationSchema
>;
export const subagentProfilesConfigurationSchema = z
  .object({
    scope: subagentProfileScopeSchema,
    document: subagentProfilesDocumentSchema.nullable(),
    digest: z.string().min(1).nullable(),
    trust: subagentProfileTrustSchema,
    diagnostics: z.array(subagentProfileDiagnosticSchema),
    profiles: z.array(subagentProfileConfigurationSchema),
  })
  .strict();
export type SubagentProfilesConfiguration = z.infer<
  typeof subagentProfilesConfigurationSchema
>;

/** Host reads raw JSON without losing invalid entries; read/JSON errors go in error. */
export interface SubagentProfileLayer {
  source: SubagentProfileScope;
  document?: unknown;
  digest?: string;
  path?: string;
  trust?: "trusted" | "untrusted";
  error?: string;
}
export interface ResolveSubagentProfilesOptions {
  layers: readonly SubagentProfileLayer[];
  scope?: SubagentProfileScope;
  /** Availability checks are host-owned; never mutate or delete portable references. */
  diagnostics?: (
    profile: SubagentProfile,
  ) => readonly SubagentProfileDiagnostic[];
}

function mergeEntry(
  lower: SubagentProfileEntry,
  upper: SubagentProfileEntry,
): SubagentProfileEntry {
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
export function resolveSubagentProfiles(
  options: ResolveSubagentProfilesOptions,
): SubagentProfilesConfiguration {
  const scope = options.scope ?? "conversation";
  const order: SubagentProfileScope[] = ["user", "project", "conversation"];
  const layers = order
    .slice(0, order.indexOf(scope) + 1)
    .map((source) => options.layers.find((layer) => layer.source === source))
    .filter((layer): layer is SubagentProfileLayer => !!layer);
  const documentErrors: SubagentProfileDiagnostic[] = [];
  const decoded = layers.map((layer) => {
    const envelope = z
      .object({
        schemaVersion: z.literal(1),
        profiles: subagentRecordSchema(subagentProfileNameSchema, z.unknown()),
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
    ...builtInSubagentProfiles.map((profile) => profile.name),
    ...decoded.flatMap(({ entries }) => Object.keys(entries)),
  ]);
  const profiles: SubagentProfileConfiguration[] = [];
  for (const name of names) {
    const builtin = builtInSubagentProfiles.find(
      (profile) => profile.name === name,
    );
    let merged: SubagentProfileEntry = builtin
      ? subagentProfileEntrySchema.parse(
          Object.fromEntries(
            Object.entries(builtin).filter(([key]) => key !== "name"),
          ),
        )
      : {};
    const origins: SubagentProfileConfiguration["origins"] = {
      fields: {},
      tools: {},
      skills: {},
    };
    if (builtin)
      for (const field of Object.keys(merged))
        setOwn(origins.fields, field, "builtin");
    let source: SubagentProfileSource = "builtin";
    let inherited: SubagentProfileEntry | null = null;
    let local: SubagentProfileEntry | null = null;
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
      const parsed = subagentProfileEntrySchema.safeParse(entries[name]);
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
            "Trust the current project subagents.json before using this profile.",
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
    const complete = subagentProfileDraftSchema.safeParse({ name, ...merged });
    let effective: SubagentProfile | null = null;
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
  const parsedDocument = subagentProfilesDocumentSchema.safeParse(
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
