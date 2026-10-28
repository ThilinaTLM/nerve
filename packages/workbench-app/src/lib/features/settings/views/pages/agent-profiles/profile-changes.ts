import { AGENT_PROFILE_NAME_MAX_LENGTH } from "@nervekit/contracts/agent-profiles";
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
  | "instructions"
  | `tool:${string}`
  | `skill:${"file" | "nerve" | "agentBrowser"}:${string}`;
export type ModelChangeValue = {
  model?: ModelSelection;
  thinking?: ThinkingLevel;
  modelMode?: ChangeMode;
  thinkingMode?: ChangeMode;
};
export const changeKinds = [
  { key: "model", label: "Model" },
  { key: "permission", label: "Permissions" },
  { key: "compaction", label: "Compaction" },
  { key: "tool", label: "Tool" },
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
  ] as const) {
    const value = field(profile, pointer);
    if (value.value !== undefined)
      rows.push({ key, label: changeLabel(key), ...value });
  }
  for (const source of ["file", "nerve", "agentBrowser"] as const) {
    const recommended = profile.recommendations?.skills?.[source] ?? {};
    const required = profile.requirements?.skills?.[source] ?? {};
    for (const name of new Set([
      ...Object.keys(recommended),
      ...Object.keys(required),
    ])) {
      rows.push({
        key: `skill:${source}:${name}`,
        label: name,
        mode: required[name] !== undefined ? "require" : "recommend",
        value: required[name] ?? recommended[name],
      });
    }
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
    next.instructions =
      change.mode === "settings" ? "" : String(change.value ?? "");
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
  if (change.key.startsWith("skill:")) {
    const [, source, ...parts] = change.key.split(":");
    const name = parts.join(":");
    for (const contribution of ["recommendations", "requirements"] as const) {
      const skills = next[contribution]?.skills;
      if (!skills) continue;
      const bucket = skills[source as "file" | "nerve" | "agentBrowser"];
      if (bucket) delete bucket[name];
    }
    if (change.mode !== "settings") {
      const target = section(change.mode);
      const skills = next[target]?.skills ?? {};
      next[target] = {
        ...next[target],
        skills: {
          ...skills,
          [source!]: {
            ...skills[source as "file" | "nerve" | "agentBrowser"],
            [name]: Boolean(change.value),
          },
        },
      };
    }
  } else if (change.key === "model") {
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
        : (change.key as "compaction"),
      change.value,
      change.mode,
    );
  return profileDefinitionSchema.parse(next);
}
export function normalizeProfileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, AGENT_PROFILE_NAME_MAX_LENGTH);
}
export function duplicateProfileName(name: string): string {
  return `${name.slice(0, AGENT_PROFILE_NAME_MAX_LENGTH - 5).replace(/-+$/g, "")}-copy`;
}

/** A single policy choice explicitly unifies model and reasoning, retaining absent fields. */
export function unifyChangeMode(
  row: { key: ChangeKey; value: unknown },
  mode: ChangeMode,
) {
  if (row.key !== "model") return { ...row, mode };
  const value = row.value as ModelChangeValue | undefined;
  return {
    ...row,
    mode,
    value: {
      ...value,
      modelMode: mode === "settings" || !value?.model ? "settings" : mode,
      thinkingMode:
        mode === "settings" || value?.thinking === undefined
          ? "settings"
          : mode,
    },
  };
}
export const changeKeywords: Partial<Record<ChangeKey, string[]>> = {
  model: ["llm", "provider", "thinking", "reasoning"],
  permission: ["approval", "safety", "planning"],
  compaction: ["compression", "context", "tokens", "summarize"],
  instructions: ["prompt", "system prompt", "guidance"],
};
export function defaultText(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return value === undefined ? "Use settings" : String(value);
}

export type AddChangeItem = {
  key: ChangeKey;
  label: string;
  group: string;
  keywords?: string[];
  defaultOn?: boolean;
  /** What one click does, e.g. Off → On; once applied, what it did. */
  flip?: { from: "On" | "Off"; to: "On" | "Off"; applied: boolean };
};
/** Baseline is captured when opening, so a just-added flip remains available to undo. */
export function buildAddChangeItems(input: {
  baseline: ChangeKey[];
  rows: ChangeRow[];
  tools: {
    key: ChangeKey;
    label: string;
    description: string;
    account?: boolean;
    defaultOn?: boolean;
  }[];
  skills: {
    key: ChangeKey;
    label: string;
    defaultOn: boolean;
    description?: string;
  }[];
}): AddChangeItem[] {
  const settings = (
    ["model", "permission", "compaction", "instructions"] as const
  ).map((key) => ({
    key,
    label: changeLabel(key),
    group: "Settings",
    keywords: changeKeywords[key],
  }));
  const flips = [
    ...input.tools.map((tool) => ({
      ...tool,
      group: tool.account ? "Account tools" : "Tools",
      keywords: [tool.key, tool.description, "tools"],
    })),
    ...input.skills.map((skill) => ({
      ...skill,
      group: "Skills",
      keywords: [skill.key, skill.description ?? ""],
    })),
  ].map((item): AddChangeItem => {
    // Tools without an on/off switch (e.g. bash) only open their settings.
    if (item.defaultOn === undefined) return item;
    const row = input.rows.find((row) => row.key === item.key);
    const from = item.defaultOn ? "On" : "Off";
    const enabled = row
      ? item.key.startsWith("tool:")
        ? (row.value as { enabled?: boolean }).enabled
        : Boolean(row.value)
      : !item.defaultOn;
    return {
      ...item,
      flip: { from, to: enabled ? "On" : "Off", applied: Boolean(row) },
    };
  });
  return [...settings, ...flips].filter(
    (item) => !input.baseline.includes(item.key),
  );
}
