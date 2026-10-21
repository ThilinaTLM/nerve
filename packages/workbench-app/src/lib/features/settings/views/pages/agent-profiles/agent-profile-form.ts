import type { ModelSelection } from "@nervekit/contracts/models";
import {
  AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
  AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  AGENT_PROFILE_NAME_MAX_LENGTH,
  agentProfileDraftSchema,
  agentProfileScalarKind,
  lockedValue,
  utf8ByteLength,
  type AgentProfile,
  type AgentProfileDraft,
  type AgentProfileCompaction,
  type AgentProfileModel,
  type AgentProfilePermission,
  type AgentProfileScalar,
  type AgentProfileScalarKind,
  type AgentProfileThinking,
  type AgentProfileUsableBy,
  type AgentProfileEntry,
  type AgentProfilePatch,
  type AgentProfileConfiguration,
} from "@nervekit/contracts/agent-profiles";
import type { ThinkingLevel } from "@nervekit/contracts/models";
import type { CompactionProfile } from "@nervekit/contracts/settings";

/** Inherit from the parent, set at application, or lock for the whole turn. */
export type ScalarForm<T> = {
  kind: AgentProfileScalarKind;
  /** `default` defers to the settings default; kept while the kind is inherit. */
  value: T | "default";
};

export type CompactionValue = {
  auto: boolean;
  profile: CompactionProfile;
  triggerPercent: number;
};

export type SkillsMode = "inherit" | "none" | "custom";

/** The editor's state: plain fields that map one-to-one onto form controls. */
export type AgentProfileForm = {
  /** Fixed once the profile exists. */
  nameLocked: boolean;
  name: string;
  /** Once edited by hand, the name stops following the label. */
  nameEdited: boolean;
  label: string;
  description: string;
  enabled: boolean;
  usableBy: AgentProfileUsableBy;
  model: ScalarForm<ModelSelection>;
  thinking: ScalarForm<ThinkingLevel>;
  permission: ScalarForm<string>;
  compaction: ScalarForm<CompactionValue>;
  /** Capability tool changes: `false` removes, `true` adds, objects replace settings. */
  tools: Record<string, boolean | Record<string, unknown>>;
  skillsMode: SkillsMode;
  skills: Record<string, boolean>;
  instructions: string;
};

export type FormErrors = Partial<Record<FormField, string>>;
export type FormField =
  | "name"
  | "label"
  | "description"
  | "model"
  | "thinking"
  | "permission"
  | "compaction"
  | "tools"
  | "skills"
  | "instructions";

export const defaultCompactionValue: CompactionValue = {
  auto: true,
  profile: "balanced",
  triggerPercent: 80,
};

function scalarToProfile<T, U extends string | object>(
  form: ScalarForm<T>,
  encode: (value: T) => U,
): AgentProfileScalar<U> {
  if (form.kind === "inherit") return "inherit";
  const value = form.value === "default" ? "default" : encode(form.value);
  return form.kind === "lock" ? { lock: value } : value;
}

function scalarFromProfile<T, U>(
  setting: AgentProfileScalar<U>,
  decode: (value: U) => T | undefined,
): ScalarForm<T> {
  const kind = agentProfileScalarKind(setting);
  const raw = lockedValue(setting) ?? (setting as U | "default" | "inherit");
  const value =
    raw === "inherit" || raw === "default"
      ? "default"
      : (decode(raw as U) ?? "default");
  return { kind, value };
}

const compactionToProfile = (value: CompactionValue) => ({
  ...(value.auto ? {} : { auto: false }),
  profile: value.profile,
  ...(value.profile === "custom"
    ? { triggerPercent: value.triggerPercent }
    : {}),
});

const compactionFromProfile = (
  value: Exclude<
    AgentProfileCompaction,
    "inherit" | "default" | { lock: unknown }
  >,
): CompactionValue => ({
  auto: value.auto ?? true,
  profile: value.profile,
  triggerPercent: value.triggerPercent ?? defaultCompactionValue.triggerPercent,
});

/** Blank draft for a new profile: usable everywhere, inheriting everything. */
export function blankForm(): AgentProfileForm {
  return {
    nameLocked: false,
    name: "",
    nameEdited: false,
    label: "",
    description: "",
    enabled: true,
    usableBy: "both",
    model: { kind: "inherit", value: "default" },
    thinking: { kind: "inherit", value: "default" },
    permission: { kind: "inherit", value: "default" },
    compaction: { kind: "inherit", value: "default" },
    tools: {},
    skillsMode: "inherit",
    skills: {},
    instructions: "",
  };
}

/** A readable file name from a label: lowercase words joined by single hyphens. */
export function deriveProfileName(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AGENT_PROFILE_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** `provider/modelId` split at the first slash; model ids may contain slashes. */
export function parseProfileModel(value: string): ModelSelection | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

export function formFromProfile(
  profile: AgentProfile,
  options: { duplicate?: boolean; takenNames?: readonly string[] } = {},
): AgentProfileForm {
  const form = blankForm();
  Object.assign(form, {
    nameLocked: !options.duplicate,
    name: profile.name,
    nameEdited: true,
    label: profile.label,
    description: profile.description,
    enabled: profile.enabled,
    usableBy: profile.usableBy,
    model: scalarFromProfile(profile.model, parseProfileModel),
    thinking: scalarFromProfile<ThinkingLevel, ThinkingLevel>(
      profile.thinking,
      (value) => value,
    ),
    permission: scalarFromProfile<string, string>(
      profile.permission,
      (value) => value,
    ),
    compaction: scalarFromProfile(profile.compaction, compactionFromProfile),
    // JSON clone: profiles often arrive as reactive proxies, which structuredClone rejects.
    tools: JSON.parse(
      JSON.stringify(profile.tools),
    ) as AgentProfileForm["tools"],
    skillsMode:
      profile.skills === "inherit" || profile.skills === "none"
        ? profile.skills
        : "custom",
    skills: typeof profile.skills === "object" ? { ...profile.skills } : {},
    instructions: profile.instructions,
  } satisfies Partial<AgentProfileForm>);
  if (options.duplicate) {
    const taken = new Set(options.takenNames ?? []);
    let name = `${profile.name}-copy`.slice(0, AGENT_PROFILE_NAME_MAX_LENGTH);
    for (let index = 2; taken.has(name); index += 1) {
      const suffix = `-copy-${index}`;
      name = `${profile.name.slice(0, AGENT_PROFILE_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    }
    form.name = name;
    form.nameEdited = true;
    form.label = `${profile.label} copy`;
  }
  return form;
}

/** Only parsed local entries are repairable; invalid raw entries must be removed deliberately. */
export function formFromConfiguration(
  configuration: AgentProfileConfiguration,
): AgentProfileForm | undefined {
  if (configuration.effective) return formFromProfile(configuration.effective);
  if (configuration.local === null) return undefined;
  const inherited = configuration.inherited ?? {};
  const local = configuration.local;
  const fields = { ...inherited, ...local };
  const skills =
    typeof inherited.skills === "object" && typeof local.skills === "object"
      ? { ...inherited.skills, ...local.skills }
      : fields.skills;
  return formFromProfile({
    ...formToDraft(blankForm()),
    ...fields,
    name: configuration.name,
    label: fields.label ?? configuration.name,
    enabled: fields.enabled ?? true,
    tools: { ...inherited.tools, ...local.tools },
    skills: skills ?? "inherit",
    source: "user",
  });
}

/** The profile content for a form, in the contract's shorthand. */
export function formToDraft(form: AgentProfileForm): AgentProfileDraft {
  const draft: AgentProfileDraft = {
    name: form.name.trim(),
    description: form.description.trim(),
    enabled: form.enabled,
    usableBy: form.usableBy,
    model: scalarToProfile(
      form.model,
      (value) => `${value.provider}/${value.modelId}` as const,
    ) as AgentProfileModel,
    thinking: scalarToProfile(
      form.thinking,
      (value) => value,
    ) as AgentProfileThinking,
    permission: scalarToProfile(
      form.permission,
      (value) => value,
    ) as AgentProfilePermission,
    compaction: scalarToProfile(
      form.compaction,
      compactionToProfile,
    ) as AgentProfileCompaction,
    skills: form.skillsMode === "custom" ? { ...form.skills } : form.skillsMode,
    instructions: form.instructions,
  };
  const label = form.label.trim();
  if (label) draft.label = label;
  if (Object.keys(form.tools).length > 0) draft.tools = { ...form.tools };
  return draft;
}

export type ProfileField = keyof AgentProfileEntry;

/** Compare against the opening snapshot, not the lower layer: equal local values stay pinned. */
export function formToPatch(
  form: AgentProfileForm,
  initial: AgentProfileForm,
  choices: {
    pinned?: readonly ProfileField[];
    reset?: readonly ProfileField[];
    tools?: readonly string[];
    skills?: readonly string[];
    resetMaps?: readonly ("tools" | "skills")[];
    local?: AgentProfileEntry | null;
    repair?: AgentProfileConfiguration;
  } = {},
): AgentProfilePatch {
  const before = formToDraft(initial);
  const after = formToDraft(form);
  const patch: Record<string, unknown> = {};
  const reset = new Set(choices.reset);
  const pinned = new Set(choices.pinned);
  if (choices.repair?.effective === null && choices.repair.local !== null) {
    for (const field of [
      "description",
      "usableBy",
      "model",
      "thinking",
      "permission",
      "compaction",
      "skills",
      "instructions",
    ] as const) {
      if (
        choices.repair.local[field] === undefined &&
        choices.repair.inherited?.[field] === undefined
      )
        pinned.add(field);
    }
  }
  for (const field of [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ] as (keyof AgentProfileDraft)[]) {
    if (field === "name") continue;
    if (reset.has(field)) {
      patch[field] = null;
      continue;
    }
    if (field === "tools" || field === "skills") continue;
    if (
      pinned.has(field) ||
      JSON.stringify(before[field]) !== JSON.stringify(after[field])
    )
      patch[field] = after[field] ?? null;
  }
  for (const field of ["tools", "skills"] as const) {
    if (reset.has(field)) {
      patch[field] = null;
      continue;
    }
    const lower = before[field] ?? {};
    const next = after[field] ?? {};
    if (choices.resetMaps?.includes(field) && typeof next === "object") {
      const changes: Record<string, unknown> = {};
      const local = choices.local?.[field];
      if (local && typeof local === "object")
        for (const name of Object.keys(local)) changes[name] = null;
      const names = pinned.has(field)
        ? Object.keys(next)
        : (choices[field] ?? []);
      for (const name of names) changes[name] = next[name] ?? null;
      patch[field] = changes;
      continue;
    }

    if (typeof next !== "object" || typeof lower !== "object") {
      if (pinned.has(field) || JSON.stringify(lower) !== JSON.stringify(next))
        patch[field] = next;
      continue;
    }
    const changes: Record<string, unknown> = {};
    for (const name of new Set([
      ...Object.keys(lower),
      ...Object.keys(next),
      ...(choices[field] ?? []),
    ])) {
      if (
        pinned.has(field) ||
        choices[field]?.includes(name) ||
        JSON.stringify(lower[name]) !== JSON.stringify(next[name])
      )
        changes[name] = next[name] ?? null;
    }
    if (Object.keys(changes).length || pinned.has(field))
      patch[field] = changes;
  }
  for (const field of reset) patch[field] = null;
  return patch as AgentProfilePatch;
}

/**
 * This layer's entry once the patch is saved, mirroring the server's patch
 * semantics: null deletes a field or a map member, a map patch merges.
 */
export function localEntryAfterSave(
  local: AgentProfileEntry | null | undefined,
  patch: AgentProfilePatch,
): AgentProfileEntry {
  const entry: Record<string, unknown> = { ...local };
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
      const current = entry[field];
      const selections: Record<string, unknown> =
        typeof current === "object" && current !== null ? { ...current } : {};
      for (const [key, selected] of Object.entries(value)) {
        if (selected === null) delete selections[key];
        else selections[key] = selected;
      }
      entry[field] = selections;
    } else entry[field] = value;
  }
  return entry as AgentProfileEntry;
}

/** Reset controls to the lower profile's values, not the lead's current values. */
export function formWithInheritedField(
  form: AgentProfileForm,
  field: ProfileField,
  inherited: AgentProfileEntry | null,
): AgentProfileForm {
  const defaults = formToDraft(blankForm());
  const lower = formFromProfile({
    ...defaults,
    ...inherited,
    name: form.name,
    label: inherited?.label ?? form.name,
    enabled: inherited?.enabled ?? true,
    tools: inherited?.tools ?? {},
    source: "builtin",
  });
  const keys: Record<ProfileField, readonly (keyof AgentProfileForm)[]> = {
    label: ["label"],
    description: ["description"],
    enabled: ["enabled"],
    usableBy: ["usableBy"],
    model: ["model"],
    thinking: ["thinking"],
    permission: ["permission"],
    instructions: ["instructions"],
    tools: ["tools"],
    skills: ["skillsMode", "skills"],
    compaction: ["compaction"],
  };
  return {
    ...form,
    ...Object.fromEntries(keys[field].map((key) => [key, lower[key]])),
  };
}

/**
 * Field errors for the form. The contract schema is the authority; the extra
 * checks cover what the schema cannot see (a model not chosen, a name already
 * taken in the scope).
 */
export function validateForm(
  form: AgentProfileForm,
  context: {
    takenNames?: readonly string[];
    resetFields?: readonly ProfileField[];
  } = {},
): FormErrors {
  const errors: FormErrors = {};
  if (form.label.trim().length > AGENT_PROFILE_LABEL_MAX_LENGTH)
    errors.label = `Use at most ${AGENT_PROFILE_LABEL_MAX_LENGTH} characters.`;
  if (!form.name.trim()) errors.name = "Enter a name.";
  else if (!form.nameLocked && context.takenNames?.includes(form.name.trim()))
    errors.name = "A profile with this name already exists in this scope.";
  if (!form.description.trim()) errors.description = "Describe the profile.";
  else if (
    form.description.trim().length > AGENT_PROFILE_DESCRIPTION_MAX_LENGTH
  )
    errors.description = `Use at most ${AGENT_PROFILE_DESCRIPTION_MAX_LENGTH} characters.`;
  if (utf8ByteLength(form.instructions) > AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES)
    errors.instructions = `Instructions are limited to ${AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES / 1024} KB.`;
  const parsed = agentProfileDraftSchema.safeParse(formToDraft(form));
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const field = fieldOf(issue.path[0]);
      if (field && !errors[field]) errors[field] = issue.message;
    }
  for (const field of context.resetFields ?? []) {
    const errorField = fieldOf(field);
    if (errorField) delete errors[errorField];
  }
  return errors;
}

function fieldOf(key: PropertyKey | undefined): FormField | undefined {
  switch (key) {
    case "name":
    case "label":
    case "description":
    case "instructions":
    case "tools":
    case "skills":
      return key;
    case "model":
    case "thinking":
    case "permission":
    case "compaction":
      return key;
    default:
      return undefined;
  }
}

/** Whether saving would change nothing; used to keep Save disabled. */
export function formsEqual(
  left: AgentProfileForm,
  right: AgentProfileForm,
): boolean {
  return (
    JSON.stringify(formToDraft(left)) === JSON.stringify(formToDraft(right))
  );
}
