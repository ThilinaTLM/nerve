import { z } from "zod";
import { defaultSettings } from "../settings/settings.js";
import type { ModelSelection, ThinkingLevel } from "../models/models.js";
import {
  childLaunchOverridesSchema,
  childSettingsOverridesSchema,
  leadSettingsOverridesSchema,
  completeChildSettingsSchema,
  canonicalSettingsEntries,
  requirementOverlaps,
  sha256HexSchema,
  configurationSourceSchema,
  fieldProvenanceSchema,
  agentResolutionSchema,
  type AppliedProfile,
  type LeadSettingsOverrides,
  type CompleteChildSettings,
} from "./schemas.js";

export type ConfigurationSource = z.infer<typeof configurationSourceSchema>;
export type FieldProvenance = z.infer<typeof fieldProvenanceSchema>;
export interface ResolutionOptions {
  role: "lead" | "child";
  user?: LeadSettingsOverrides;
  project?: LeadSettingsOverrides;
  process?: LeadSettingsOverrides;
  conversation?: LeadSettingsOverrides;
  appliedProfile?: AppliedProfile | null;
  frozenDefaults?: CompleteChildSettings;
  launch?: z.infer<typeof childLaunchOverridesSchema>;
  eligibleSkills?: Partial<Record<"file" | "nerve" | "agentBrowser", string[]>>;
  /** Inject the existing model-catalog clamp; required when checking model compatibility. */
  clampThinking?: (
    model: ModelSelection,
    level: ThinkingLevel,
  ) => ThinkingLevel;
  referenceAvailable?: (pointer: string, value: unknown) => boolean;
}
export type ResolutionResult = z.infer<typeof agentResolutionSchema>;
const builtin: LeadSettingsOverrides = {
  reasoningLevel: defaultSettings.defaultThinkingLevel,
  permissionRuleSetId: defaultSettings.defaultPermissionRuleSetId,
  compaction: defaultSettings.compaction,
  retry: defaultSettings.retry,
  tools: {
    python_exec: { enabled: true, settings: {} },
    web_search: { enabled: true },
    web_fetch: { enabled: true },
    jira: { enabled: false },
    confluence: { enabled: false },
    explain_image: {
      enabled: false,
      settings: defaultSettings.tools.imageExplanation,
    },
    generate_image: {
      enabled: false,
      settings: defaultSettings.tools.imageGeneration,
    },
    kroki_export: { enabled: false, settings: defaultSettings.tools.kroki },
    bash: { settings: defaultSettings.tools.bash },
    plan_present: {
      enabled: false,
      settings: defaultSettings.tools.planPresent,
    },
    subagents: { enabled: false },
  },
  skills: {
    defaults: { file: true, nerve: false, agentBrowser: false },
    file: {},
    nerve: {},
    agentBrowser: {},
  },
};
function parts(pointer: string): string[] {
  return pointer
    .slice(1)
    .split("/")
    .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"));
}
function put(target: Record<string, unknown>, pointer: string, value: unknown) {
  const keys = parts(pointer);
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(node, key))
      Object.defineProperty(node, key, {
        value: {},
        writable: true,
        enumerable: true,
        configurable: true,
      });
    node = node[key] as Record<string, unknown>;
  }
  Object.defineProperty(node, keys.at(-1)!, {
    value: structuredClone(value),
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
/** Role projection is for underlying defaults only; profile contributions must validate without projection. */
export function projectChildSettings(
  settings: LeadSettingsOverrides,
): z.infer<typeof childSettingsOverridesSchema> {
  const copy = structuredClone(leadSettingsOverridesSchema.parse(settings));
  delete copy.subagents;
  if (copy.tools) {
    delete copy.tools.subagents;
    delete copy.tools.plan_present;
  }
  return childSettingsOverridesSchema.parse(copy);
}
export function resolveAgentConfiguration(
  options: ResolutionOptions,
): ResolutionResult {
  const profile = options.appliedProfile;
  if (
    requirementOverlaps(profile?.recommendations, profile?.requirements).length
  )
    throw new Error("Overlapping profile contributions");
  const roleSchema =
    options.role === "child"
      ? childSettingsOverridesSchema
      : leadSettingsOverridesSchema;
  if (profile) {
    roleSchema.parse(profile.recommendations);
    roleSchema.parse(profile.requirements);
  }
  if (options.role === "lead" && (options.frozenDefaults || options.launch))
    throw new Error("Child-only creation inputs");
  if (options.frozenDefaults && options.launch)
    throw new Error("An existing child's launch choices are already frozen");
  const layers: {
    source: ConfigurationSource;
    value: LeadSettingsOverrides;
  }[] = [];
  if (options.frozenDefaults)
    layers.push({
      source: "frozen",
      value: completeChildSettingsSchema.parse(options.frozenDefaults),
    });
  else {
    for (const [source, value] of [
      ["builtin", builtin],
      ["user", options.user],
      ["project", options.project],
      ["process", options.process],
    ] as const)
      if (value)
        layers.push({
          source,
          value:
            options.role === "child"
              ? projectChildSettings(leadSettingsOverridesSchema.parse(value))
              : leadSettingsOverridesSchema.parse(value),
        });
    if (profile)
      layers.push({ source: "recommendation", value: profile.recommendations });
  }
  if (options.conversation)
    layers.push({
      source: "conversation",
      value: roleSchema.parse(options.conversation),
    });
  if (options.launch)
    layers.push({
      source: "launch",
      value: childLaunchOverridesSchema.parse(options.launch),
    });
  if (profile)
    layers.push({ source: "requirement", value: profile.requirements });
  const result: ResolutionResult = {
    settings: {
      tools: { python_exec: { settings: {} } },
      skills: { file: {}, nerve: {}, agentBrowser: {} },
    },
    provenance: {},
    diagnostics: [],
  };
  for (const { source, value } of layers)
    for (const [pointer, field] of canonicalSettingsEntries(value)) {
      put(result.settings, pointer, field);
      result.provenance[pointer] = {
        source,
        ...((source === "recommendation" || source === "requirement") && profile
          ? { profile: profile.name }
          : {}),
      };
    }
  // Named decisions and source defaults compete within each layer, not as generic object leaves.
  for (const source of ["file", "nerve", "agentBrowser"] as const) {
    const names = options.frozenDefaults
      ? Object.keys(options.frozenDefaults.skills[source])
      : [
          ...new Set(
            options.eligibleSkills?.[source] ??
              layers.flatMap((l) =>
                Object.keys(l.value.skills?.[source] ?? {}),
              ),
          ),
        ];
    if (options.frozenDefaults && result.settings.skills)
      result.settings.skills[source] = {};
    for (const name of names)
      for (const layer of [...layers].reverse()) {
        const named = layer.value.skills?.[source];
        const decision =
          (named && Object.hasOwn(named, name) ? named[name] : undefined) ??
          layer.value.skills?.defaults?.[source];
        if (decision !== undefined) {
          const pointer = `/skills/${source}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
          put(result.settings, pointer, decision);
          result.provenance[pointer] = {
            source: layer.source,
            ...(layer.source === "requirement" ||
            layer.source === "recommendation"
              ? { profile: profile?.name }
              : {}),
          };
          break;
        }
      }
  }
  const { model, reasoningLevel } = result.settings;
  if (!model)
    result.diagnostics.push({ code: "model-required", pointer: "/model" });
  if (model && reasoningLevel && options.clampThinking) {
    const adjusted = options.clampThinking(model, reasoningLevel);
    if (adjusted !== reasoningLevel) {
      const reasoningSource = result.provenance["/reasoningLevel"].source;
      const modelSource = result.provenance["/model"].source;
      // Fit mixed-layer choices, never a required level or an invalid authored pair.
      if (reasoningSource === "requirement" || reasoningSource === modelSource)
        result.diagnostics.push({
          code: "unsupported-reasoning",
          pointer: "/reasoningLevel",
        });
      else {
        result.settings.reasoningLevel = adjusted;
        result.provenance["/reasoningLevel"].adjusted = true;
        result.diagnostics.push({
          code: "reasoning-adjusted",
          pointer: "/reasoningLevel",
        });
      }
    }
  }
  if (options.referenceAvailable)
    for (const [pointer, value] of canonicalSettingsEntries(result.settings))
      if (
        (pointer.endsWith("/model") ||
          pointer.endsWith("/profileId") ||
          pointer.endsWith("/permissionRuleSetId") ||
          pointer.endsWith("/approvalProfile")) &&
        !options.referenceAvailable(pointer, value)
      )
        result.diagnostics.push({ code: "missing-reference", pointer });
  return result;
}
/** Capture below requirements; never copy parent preferences. */
export function freezeChildPreferences(
  options: Omit<ResolutionOptions, "role" | "frozenDefaults" | "conversation">,
): CompleteChildSettings {
  if (options.appliedProfile) {
    childSettingsOverridesSchema.parse(options.appliedProfile.requirements);
    if (
      requirementOverlaps(
        options.appliedProfile.recommendations,
        options.appliedProfile.requirements,
      ).length
    )
      throw new Error("Overlapping profile contributions");
  }
  const appliedProfile = options.appliedProfile
    ? { ...options.appliedProfile, requirements: {} }
    : null;
  const result = resolveAgentConfiguration({
    ...options,
    role: "child",
    appliedProfile,
  });
  if (result.diagnostics.some((d) => d.code === "unsupported-reasoning"))
    throw new Error("Unsupported child launch reasoning");
  const frozen = completeChildSettingsSchema.parse(result.settings);
  for (const source of ["file", "nerve", "agentBrowser"] as const) {
    const eligible = new Set(options.eligibleSkills?.[source] ?? []);
    frozen.skills[source] = Object.fromEntries(
      Object.entries(frozen.skills[source]).filter(([name]) =>
        eligible.has(name),
      ),
    );
  }
  return frozen;
}

export const agentMutationSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedDigest: z.union([sha256HexSchema, z.literal("missing")]),
  changes: leadSettingsOverridesSchema,
  resets: z.array(z.string().regex(/^\/overrides(?:\/(?:[^~/]|~[01])*)+$/)),
});
/** Pure sparse mutation. Store owns revision/digest checks and receipt preservation. */
export function applySettingsMutation(
  current: LeadSettingsOverrides,
  mutation: z.input<typeof agentMutationSchema>,
  requirements: LeadSettingsOverrides = {},
  role: "lead" | "child" = "lead",
): LeadSettingsOverrides {
  const parsed = agentMutationSchema.parse(mutation);
  const schema =
    role === "child"
      ? childSettingsOverridesSchema
      : leadSettingsOverridesSchema;
  schema.parse(current);
  schema.parse(parsed.changes);
  schema.parse(requirements);
  const operations = [
    ...canonicalSettingsEntries(parsed.changes).map(([p]) => `/overrides${p}`),
    ...parsed.resets,
  ];
  const overlaps = (a: string, b: string) =>
    a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
  const locks = canonicalSettingsEntries(requirements).map(
    ([p]) => `/overrides${p}`,
  );
  for (const [i, path] of operations.entries()) {
    if (operations.slice(i + 1).some((other) => overlaps(path, other)))
      throw new Error("Overlapping mutation operations");
    const skillDefaultLock = locks.some((lock) => {
      const match = /^\/overrides\/skills\/defaults\/([^/]+)$/.exec(lock);
      return match && overlaps(path, `/overrides/skills/${match[1]}`);
    });
    if (
      locks.some((lock) => overlaps(path, lock)) ||
      skillDefaultLock ||
      requirementOverlaps(parsed.changes, requirements).length
    )
      throw new Error("Required field is not editable");
  }
  const result = structuredClone(current) as Record<string, unknown>;
  for (const pointer of parsed.resets) {
    const keys = parts(pointer).slice(1);
    // Validate structural paths; never allow descent into atomic values.
    const relative = pointer.slice(10);
    const atomicAncestor =
      [
        "/model",
        "/tools/generate_image/settings",
        "/tools/bash/settings/autoPromotion",
      ].some((p) => relative.startsWith(p + "/")) ||
      /^\/subagents\/[^/]+\/model\//.test(relative) ||
      relative.startsWith("/tools/explain_image/settings/model/");
    if (atomicAncestor)
      throw new Error("Reset must target a canonical merge unit");
    let cursor: z.ZodType = schema;
    for (const key of keys) {
      while (cursor instanceof z.ZodOptional)
        cursor = cursor.unwrap() as z.ZodType;
      if (cursor instanceof z.ZodObject && Object.hasOwn(cursor.shape, key))
        cursor = cursor.shape[key] as z.ZodType;
      else if (cursor instanceof z.ZodRecord) {
        z.parse(cursor.keyType, key);
        cursor = cursor.valueType as z.ZodType;
      } else throw new Error("Unknown reset path");
    }
    function remove(node: Record<string, unknown>, depth: number) {
      const key = keys[depth];
      if (depth === keys.length - 1) delete node[key];
      else if (
        Object.hasOwn(node, key) &&
        node[key] &&
        typeof node[key] === "object"
      ) {
        remove(node[key] as Record<string, unknown>, depth + 1);
        if (!Object.keys(node[key]).length) delete node[key];
      }
    }
    remove(result, 0);
  }
  for (const [pointer, value] of canonicalSettingsEntries(parsed.changes))
    put(result, pointer, value);
  return schema.parse(result);
}
