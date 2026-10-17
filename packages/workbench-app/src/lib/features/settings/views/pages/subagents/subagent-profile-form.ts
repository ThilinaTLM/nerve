import type { ModelSelection } from "@nervekit/contracts/models";
import {
  SUBAGENT_INSTRUCTIONS_MAX_BYTES,
  SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  SUBAGENT_PROFILE_LABEL_MAX_LENGTH,
  SUBAGENT_PROFILE_NAME_MAX_LENGTH,
  subagentProfileDraftSchema,
  utf8ByteLength,
  type SubagentProfile,
  type SubagentProfileDraft,
  type SubagentProfileThinking,
  type SubagentProfileEntry,
  type SubagentProfilePatch,
  type SubagentProfileConfiguration,
} from "@nervekit/contracts/subagents";
import type { CompactionProfile } from "@nervekit/contracts/settings";
import type { SubagentPermissionRuleSetId } from "@nervekit/contracts/subagents";

export type SkillsMode = "inherit" | "none" | "custom";

/** The editor's state: plain fields that map one-to-one onto form controls. */
export type SubagentProfileForm = {
  /** Fixed once the profile exists. */
  nameLocked: boolean;
  name: string;
  /** Once edited by hand, the name stops following the label. */
  nameEdited: boolean;
  label: string;
  description: string;
  enabled: boolean;
  /** `lead` copies the lead's model at creation. */
  modelLead: boolean;
  model: ModelSelection | undefined;
  thinking: SubagentProfileThinking;
  permission: SubagentPermissionRuleSetId;
  compactionMode: "inherit" | "profile";
  compactionAuto: boolean;
  compactionProfile: CompactionProfile;
  triggerPercent: number;
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
  | "compaction"
  | "tools"
  | "skills"
  | "instructions";

/** Blank draft for a new profile: read-only and the lead's values for everything else. */
export function blankForm(): SubagentProfileForm {
  return {
    nameLocked: false,
    name: "",
    nameEdited: false,
    label: "",
    description: "",
    enabled: true,
    modelLead: true,
    model: undefined,
    thinking: "lead",
    permission: "read_only",
    compactionMode: "inherit",
    compactionAuto: true,
    compactionProfile: "balanced",
    triggerPercent: 80,
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
    .slice(0, SUBAGENT_PROFILE_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** `provider/modelId` split at the first slash; model ids may contain slashes. */
export function parseProfileModel(value: string): ModelSelection | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

export function formFromProfile(
  profile: SubagentProfile,
  options: { duplicate?: boolean; takenNames?: readonly string[] } = {},
): SubagentProfileForm {
  const form = blankForm();
  const model =
    profile.model === "lead" ? undefined : parseProfileModel(profile.model);
  const compaction = profile.compaction;
  Object.assign(form, {
    nameLocked: !options.duplicate,
    name: profile.name,
    nameEdited: true,
    label: profile.label,
    description: profile.description,
    enabled: profile.enabled,
    modelLead: profile.model === "lead" || model === undefined,
    model,
    thinking: profile.thinking,
    permission: profile.permission,
    // JSON clone: profiles often arrive as reactive proxies, which structuredClone rejects.
    tools: JSON.parse(
      JSON.stringify(profile.tools),
    ) as SubagentProfileForm["tools"],
    skillsMode:
      profile.skills === "inherit" || profile.skills === "none"
        ? profile.skills
        : "custom",
    skills: typeof profile.skills === "object" ? { ...profile.skills } : {},
    instructions: profile.instructions,
  } satisfies Partial<SubagentProfileForm>);
  if (compaction !== "inherit") {
    form.compactionMode = "profile";
    form.compactionAuto = compaction.auto ?? true;
    form.compactionProfile = compaction.profile;
    form.triggerPercent = compaction.triggerPercent ?? form.triggerPercent;
  }
  if (options.duplicate) {
    const taken = new Set(options.takenNames ?? []);
    let name = `${profile.name}-copy`.slice(
      0,
      SUBAGENT_PROFILE_NAME_MAX_LENGTH,
    );
    for (let index = 2; taken.has(name); index += 1) {
      const suffix = `-copy-${index}`;
      name = `${profile.name.slice(0, SUBAGENT_PROFILE_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    }
    form.name = name;
    form.nameEdited = true;
    form.label = `${profile.label} copy`;
  }
  return form;
}

/** Only parsed local entries are repairable; invalid raw entries must be removed deliberately. */
export function formFromConfiguration(
  configuration: SubagentProfileConfiguration,
): SubagentProfileForm | undefined {
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
export function formToDraft(form: SubagentProfileForm): SubagentProfileDraft {
  const draft: SubagentProfileDraft = {
    name: form.name.trim(),
    description: form.description.trim(),
    enabled: form.enabled,
    model:
      form.modelLead || !form.model
        ? "lead"
        : `${form.model.provider}/${form.model.modelId}`,
    thinking: form.thinking,
    permission: form.permission,
    compaction:
      form.compactionMode === "inherit"
        ? "inherit"
        : {
            ...(form.compactionAuto ? {} : { auto: false }),
            profile: form.compactionProfile,
            ...(form.compactionProfile === "custom"
              ? {
                  triggerPercent: form.triggerPercent,
                }
              : {}),
          },
    skills: form.skillsMode === "custom" ? { ...form.skills } : form.skillsMode,
    instructions: form.instructions,
  };
  const label = form.label.trim();
  if (label) draft.label = label;
  if (Object.keys(form.tools).length > 0) draft.tools = { ...form.tools };
  return draft;
}

export type ProfileField = keyof SubagentProfileEntry;

/** Compare against the opening snapshot, not the lower layer: equal local values stay pinned. */
export function formToPatch(
  form: SubagentProfileForm,
  initial: SubagentProfileForm,
  choices: {
    pinned?: readonly ProfileField[];
    reset?: readonly ProfileField[];
    tools?: readonly string[];
    skills?: readonly string[];
    resetMaps?: readonly ("tools" | "skills")[];
    local?: SubagentProfileEntry | null;
    repair?: SubagentProfileConfiguration;
  } = {},
): SubagentProfilePatch {
  const before = formToDraft(initial);
  const after = formToDraft(form);
  const patch: Record<string, unknown> = {};
  const reset = new Set(choices.reset);
  const pinned = new Set(choices.pinned);
  if (choices.repair?.effective === null && choices.repair.local !== null) {
    for (const field of [
      "description",
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
  ] as (keyof SubagentProfileDraft)[]) {
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
  return patch as SubagentProfilePatch;
}

/**
 * This layer's entry once the patch is saved, mirroring the server's patch
 * semantics: null deletes a field or a map member, a map patch merges.
 */
export function localEntryAfterSave(
  local: SubagentProfileEntry | null | undefined,
  patch: SubagentProfilePatch,
): SubagentProfileEntry {
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
  return entry as SubagentProfileEntry;
}

/** Reset controls to the lower profile's values, not the lead's current values. */
export function formWithInheritedField(
  form: SubagentProfileForm,
  field: ProfileField,
  inherited: SubagentProfileEntry | null,
): SubagentProfileForm {
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
  const keys: Record<ProfileField, readonly (keyof SubagentProfileForm)[]> = {
    label: ["label"],
    description: ["description"],
    enabled: ["enabled"],
    model: ["modelLead", "model"],
    thinking: ["thinking"],
    permission: ["permission"],
    instructions: ["instructions"],
    tools: ["tools"],
    skills: ["skillsMode", "skills"],
    compaction: [
      "compactionMode",
      "compactionAuto",
      "compactionProfile",
      "triggerPercent",
    ],
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
  form: SubagentProfileForm,
  context: {
    takenNames?: readonly string[];
    resetFields?: readonly ProfileField[];
  } = {},
): FormErrors {
  const errors: FormErrors = {};
  if (form.label.trim().length > SUBAGENT_PROFILE_LABEL_MAX_LENGTH)
    errors.label = `Use at most ${SUBAGENT_PROFILE_LABEL_MAX_LENGTH} characters.`;
  if (!form.name.trim()) errors.name = "Enter a name.";
  else if (!form.nameLocked && context.takenNames?.includes(form.name.trim()))
    errors.name = "A profile with this name already exists in this scope.";
  if (!form.modelLead && !form.model) errors.model = "Choose a model.";
  if (!form.description.trim()) errors.description = "Describe the profile.";
  else if (
    form.description.trim().length > SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH
  )
    errors.description = `Use at most ${SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH} characters.`;
  if (utf8ByteLength(form.instructions) > SUBAGENT_INSTRUCTIONS_MAX_BYTES)
    errors.instructions = `Instructions are limited to ${SUBAGENT_INSTRUCTIONS_MAX_BYTES / 1024} KB.`;
  const parsed = subagentProfileDraftSchema.safeParse(formToDraft(form));
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
      return "model";
    case "compaction":
      return "compaction";
    default:
      return undefined;
  }
}

/** Whether saving would change nothing; used to keep Save disabled. */
export function formsEqual(
  left: SubagentProfileForm,
  right: SubagentProfileForm,
): boolean {
  return (
    JSON.stringify(formToDraft(left)) === JSON.stringify(formToDraft(right))
  );
}
