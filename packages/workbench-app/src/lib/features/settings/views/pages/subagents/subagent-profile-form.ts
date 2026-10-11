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
  keepRecentPercent: number;
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

/** Blank Developer-like draft, the starting point of Add. */
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
    permission: "autonomous",
    compactionMode: "inherit",
    compactionAuto: true,
    compactionProfile: "balanced",
    triggerPercent: 80,
    keepRecentPercent: 15,
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
    tools: structuredClone(profile.tools),
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
    form.keepRecentPercent =
      compaction.keepRecentPercent ?? form.keepRecentPercent;
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

/** The profile file content for a form, in the contract's shorthand. */
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
                  keepRecentPercent: form.keepRecentPercent,
                }
              : {}),
          },
    skills:
      form.skillsMode === "custom"
        ? Object.keys(form.skills).length > 0
          ? { ...form.skills }
          : "inherit"
        : form.skillsMode,
    instructions: form.instructions,
  };
  const label = form.label.trim();
  if (label) draft.label = label;
  if (Object.keys(form.tools).length > 0) draft.tools = { ...form.tools };
  return draft;
}

/**
 * Field errors for the form. The contract schema is the authority; the extra
 * checks cover what the schema cannot see (a model not chosen, a name already
 * taken in the scope).
 */
export function validateForm(
  form: SubagentProfileForm,
  context: { takenNames?: readonly string[] } = {},
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
