/**
 * Pure model of a profile's change list. A profile is a template: each setting
 * it names has a mode (Use settings = absent, Same as lead, Set, Lock). This
 * module turns a profile draft into display rows and turns an edited change
 * back into an `AgentProfilePatch`.
 */
import type {
  AgentProfileDraft,
  AgentProfilePatch,
  AgentProfileSetting,
  AgentProfileUsableBy,
} from "@nervekit/contracts/agent-profiles";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import { agentProfileSettingKind } from "@nervekit/contracts/agent-profiles";

export type ChangeMode = "set" | "lock" | "lead";
/** A change's identity: a setting, or one tool. */
export type ChangeKey =
  | "model"
  | "permission"
  | "compaction"
  | "skills"
  | "instructions"
  | `tool:${string}`;

/** The combined Model change: either field may be left as Use settings. */
export type ModelChangeValue = {
  model?: ModelSelection;
  thinking?: ThinkingLevel;
};

export const changeKinds = [
  { key: "model", label: "Model" },
  { key: "permission", label: "Permissions" },
  { key: "compaction", label: "Compaction" },
  { key: "tool", label: "Tool" },
  { key: "skills", label: "Skills" },
  { key: "instructions", label: "Instructions" },
] as const;

export function changeLabel(key: ChangeKey): string {
  if (key.startsWith("tool:")) return "Tool";
  return changeKinds.find((kind) => kind.key === key)?.label ?? key;
}

export const modeLabels: Record<ChangeMode, string> = {
  set: "Set",
  lock: "Locked",
  lead: "Same as lead",
};

/** Set and Lock are always available; Same as lead only for sub-agent use. */
export function modesFor(usableBy: AgentProfileUsableBy): ChangeMode[] {
  return usableBy === "lead" ? ["set", "lock"] : ["set", "lock", "lead"];
}

export function modeHint(mode: ChangeMode): string {
  switch (mode) {
    case "set":
      return "Applied when the profile is used. It can still be changed in the conversation.";
    case "lock":
      return "Applied, and it can't be changed in the conversation.";
    case "lead":
      return "Sub-agents follow whatever the lead agent uses.";
  }
}

export type ChangeRow = {
  key: ChangeKey;
  label: string;
  /** Instructions are plain text; everything else carries a mode. */
  mode?: ChangeMode;
  /** The setting's value, for the row's display text and the editor. */
  value: unknown;
};

function modeOf(setting: AgentProfileSetting<unknown>): ChangeMode {
  const kind = agentProfileSettingKind(setting);
  return kind === "use-settings" ? "set" : kind;
}
function valueOf<T>(setting: AgentProfileSetting<T>): T | undefined {
  if (setting === "lead") return undefined;
  return "set" in setting ? setting.set : setting.lock;
}

/** Rows in a stable order: model, permission, compaction, tools, skills, instructions. */
export function changeRows(profile: AgentProfileDraft): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const add = (
    key: ChangeKey,
    setting: AgentProfileSetting<unknown> | undefined,
  ) => {
    if (setting === undefined) return;
    rows.push({
      key,
      label: changeLabel(key),
      mode: modeOf(setting),
      value: valueOf(setting),
    });
  };
  if (profile.model !== undefined || profile.thinking !== undefined) {
    // One combined row: the model and its reasoning level are separate
    // settings in the file but read and edit as one.
    const concrete: AgentProfileSetting<unknown> | undefined = [
      profile.model,
      profile.thinking,
    ].find((setting) => setting !== undefined && setting !== "lead");
    rows.push({
      key: "model",
      label: profile.model === undefined ? "Reasoning" : "Model",
      mode: concrete ? modeOf(concrete) : "lead",
      value: {
        model: profile.model && valueOf(profile.model),
        thinking: profile.thinking && valueOf(profile.thinking),
      } satisfies ModelChangeValue,
    });
  }
  add("permission", profile.permission);
  add("compaction", profile.compaction);
  for (const [name, setting] of Object.entries(profile.tools ?? {}))
    add(`tool:${name}`, setting as AgentProfileSetting<unknown>);
  add("skills", profile.skills);
  if (profile.instructions.trim())
    rows.push({
      key: "instructions",
      label: "Instructions",
      value: profile.instructions,
    });
  return rows;
}

/** Wraps a value in its mode; Same as lead has no value. */
export function withMode<T>(
  mode: ChangeMode,
  value: T,
): AgentProfileSetting<T> {
  return mode === "lead"
    ? "lead"
    : mode === "lock"
      ? { lock: value }
      : { set: value };
}

/** The patch that sets one change; the server writes the whole file. */
export function setChangePatch(
  key: ChangeKey,
  mode: ChangeMode,
  value: unknown,
): AgentProfilePatch {
  if (key === "instructions") return { instructions: String(value) };
  if (key === "model") {
    // One mode applies to whichever fields are set; an unset field falls back
    // to Use settings.
    if (mode === "lead") return { model: "lead", thinking: "lead" };
    const { model, thinking } = (value ?? {}) as ModelChangeValue;
    return {
      model: model ? withMode(mode, model) : null,
      thinking: thinking ? withMode(mode, thinking) : null,
    } as AgentProfilePatch;
  }
  if (key.startsWith("tool:"))
    return {
      tools: { [key.slice(5)]: withMode(mode, value) },
    } as AgentProfilePatch;
  return { [key]: withMode(mode, value) } as AgentProfilePatch;
}

/** The patch that removes a change, so the setting falls back to Use settings. */
export function removeChangePatch(key: ChangeKey): AgentProfilePatch {
  if (key === "instructions") return { instructions: "" };
  if (key === "model") return { model: null, thinking: null };
  if (key.startsWith("tool:"))
    return { tools: { [key.slice(5)]: null } } as AgentProfilePatch;
  return { [key]: null } as AgentProfilePatch;
}

/** Skills value: tri-state per skill, or none. */
export type SkillBuckets = {
  file: Record<string, boolean>;
  nerve: Record<string, boolean>;
  agentBrowser: Record<string, boolean>;
};

/** "-docs, +review" style summary of a skills setting. */
export function skillsSummary(value: unknown): string {
  if (value === "none") return "None";
  const buckets = value as SkillBuckets | undefined;
  if (!buckets) return "";
  const names = [buckets.file, buckets.nerve, buckets.agentBrowser].flatMap(
    (bucket) =>
      Object.entries(bucket).map(([name, on]) => `${on ? "+" : "−"} ${name}`),
  );
  return names.join(", ");
}

/** A profile name from a label: lowercase words joined by single hyphens, at most 32 characters. */
export function nameFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}
