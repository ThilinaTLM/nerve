import {
  profileDefinitionSchema,
  type ProfileDefinition,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
export type ChangeMode = "settings" | "recommend" | "require";
export type ChangeKey =
  | "model"
  | "permission"
  | "compaction"
  | "skills"
  | "instructions"
  | `tool:${string}`;
export type ModelChangeValue = {
  model?: ModelSelection;
  thinking?: ThinkingLevel;
  modelMode?: ChangeMode;
  thinkingMode?: ChangeMode;
};
export type SkillBuckets = {
  file: Record<string, boolean>;
  nerve: Record<string, boolean>;
  agentBrowser: Record<string, boolean>;
  defaults?: Partial<Record<"file" | "nerve" | "agentBrowser", boolean>>;
};
export const changeKinds = [
  { key: "model", label: "Model" },
  { key: "permission", label: "Permissions" },
  { key: "compaction", label: "Compaction" },
  { key: "tool", label: "Tool" },
  { key: "skills", label: "Skills" },
  { key: "instructions", label: "Instructions" },
] as const;
export const modeLabels: Record<ChangeMode, string> = {
  settings: "Use settings",
  recommend: "Recommend",
  require: "Require",
};
export function changeLabel(key: ChangeKey): string {
  return key.startsWith("tool:")
    ? "Tool"
    : (changeKinds.find((k) => k.key === key)?.label ?? key);
}
export function modesFor(): ChangeMode[] {
  return ["settings", "recommend", "require"];
}
export function modeHint(mode: ChangeMode): string {
  return mode === "settings"
    ? "No profile contribution. Existing conversation choices and scoped preferences remain intact."
    : mode === "recommend"
      ? "Used unless the conversation explicitly chooses another value."
      : "Controls the effective value while this profile applies. Underlying choices are preserved.";
}
export type ChangeRow = {
  key: ChangeKey;
  label: string;
  mode?: ChangeMode;
  mixed?: boolean;
  value: unknown;
};
const section = (mode: ChangeMode) =>
  mode === "require" ? "requirements" : "recommendations";
function mergeValues(lower: unknown, upper: unknown): unknown {
  if (upper === undefined) return lower;
  if (
    !lower ||
    !upper ||
    typeof lower !== "object" ||
    typeof upper !== "object" ||
    Array.isArray(lower) ||
    Array.isArray(upper)
  )
    return upper;
  const result: Record<string, unknown> = { ...lower };
  for (const [key, value] of Object.entries(upper))
    result[key] = mergeValues(result[key], value);
  return result;
}
function field(profile: ProfileDefinition, key: keyof LeadSettingsOverrides) {
  const required = profile.requirements?.[key],
    recommended = profile.recommendations?.[key];
  return {
    mode:
      required !== undefined
        ? ("require" as const)
        : recommended !== undefined
          ? ("recommend" as const)
          : ("settings" as const),
    value: mergeValues(recommended, required),
    mixed: required !== undefined && recommended !== undefined,
  };
}
export function changeRows(profile: ProfileDefinition): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const model = field(profile, "model"),
    reasoning = field(profile, "reasoningLevel");
  if (model.value !== undefined || reasoning.value !== undefined)
    rows.push({
      key: "model",
      label: "Model and reasoning",
      mode: model.value !== undefined ? model.mode : reasoning.mode,
      mixed: model.mode !== reasoning.mode,
      value: {
        model: model.value,
        thinking: reasoning.value,
        modelMode: model.mode,
        thinkingMode: reasoning.mode,
      },
    });
  for (const [key, pointer] of [
    ["permission", "permissionRuleSetId"],
    ["compaction", "compaction"],
    ["skills", "skills"],
  ] as const) {
    const value = field(profile, pointer);
    if (value.value !== undefined)
      rows.push({ key, label: changeLabel(key), ...value });
  }
  for (const name of new Set([
    ...Object.keys(profile.recommendations?.tools ?? {}),
    ...Object.keys(profile.requirements?.tools ?? {}),
  ])) {
    const recommended =
        profile.recommendations?.tools?.[
          name as keyof NonNullable<LeadSettingsOverrides["tools"]>
        ],
      required =
        profile.requirements?.tools?.[
          name as keyof NonNullable<LeadSettingsOverrides["tools"]>
        ];
    rows.push({
      key: `tool:${name}`,
      label: name,
      mode: required !== undefined ? "require" : "recommend",
      mixed: required !== undefined && recommended !== undefined,
      value: mergeValues(recommended, required),
    });
  }
  if (profile.instructions)
    rows.push({
      key: "instructions",
      label: "Instructions",
      value: profile.instructions,
    });
  return rows;
}
/** Move a field between contributions; Use settings removes it from both, never writes inherited values. */
export function applyProfileChange(
  profile: ProfileDefinition,
  change: { key: ChangeKey | "tool:"; mode: ChangeMode; value: unknown },
): ProfileDefinition {
  const next = structuredClone(profile);
  if (change.key === "instructions") {
    next.instructions = String(change.value ?? "");
    return profileDefinitionSchema.parse(next);
  }
  const write = (
    key: keyof LeadSettingsOverrides,
    value: unknown,
    mode: ChangeMode,
  ) => {
    for (const contribution of ["recommendations", "requirements"] as const) {
      if (next[contribution]) delete next[contribution][key];
    }
    if (mode !== "settings" && value === undefined)
      throw new Error(`Choose a value for ${key}, or use settings.`);
    if (mode !== "settings") {
      const target = section(mode);
      next[target] = { ...next[target], [key]: value };
    }
  };
  if (change.key === "model") {
    const value = change.value as ModelChangeValue | undefined;
    write("model", value?.model, value?.modelMode ?? change.mode);
    write(
      "reasoningLevel",
      value?.thinking,
      value?.thinkingMode ?? change.mode,
    );
  } else if (change.key.startsWith("tool:")) {
    const name = change.key.slice(5);
    for (const contribution of ["recommendations", "requirements"] as const)
      if (next[contribution]?.tools) {
        const tools = { ...next[contribution].tools };
        delete tools[name as keyof typeof tools];
        next[contribution] = { ...next[contribution], tools };
      }
    if (change.mode !== "settings") {
      const target = section(change.mode);
      next[target] = {
        ...next[target],
        tools: { ...next[target]?.tools, [name]: change.value },
      };
    }
  } else
    write(
      change.key === "permission"
        ? "permissionRuleSetId"
        : (change.key as "compaction" | "skills"),
      change.value === "none"
        ? { defaults: { file: false, nerve: false, agentBrowser: false } }
        : change.value,
      change.mode,
    );
  return profileDefinitionSchema.parse(next);
}
export function skillsSummary(value: unknown): string {
  const skills = value as Partial<SkillBuckets> | undefined;
  if (!skills) return "";
  if (value === "none") return "None";
  return (
    ["file", "nerve", "agentBrowser"]
      .flatMap((kind) =>
        Object.entries(skills[kind as keyof SkillBuckets] ?? {}).map(
          ([name, enabled]) => `${enabled ? "+" : "−"} ${name}`,
        ),
      )
      .join(", ") || "Source defaults"
  );
}
export function nameFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}
