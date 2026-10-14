import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  SubagentProfile,
  SubagentProfileConfiguration,
  SubagentProfileEntry,
  SubagentProfileScope,
  SubagentProfileSource,
} from "@nervekit/contracts/subagents";
import { capabilityToolGroupsFor } from "../composer/capability-tool-labels";
import { modelDisplayName } from "../utils/model";

/**
 * Shared vocabulary for sub-agent profile layers: Settings and the
 * conversation popover name and colour layers the same way.
 */
const layerOrder: readonly SubagentProfileSource[] = [
  "builtin",
  "user",
  "project",
  "conversation",
];

export const profileLayerLabels: Record<SubagentProfileSource, string> = {
  builtin: "Built-in",
  user: "User",
  project: "Project",
  conversation: "This conversation",
};

/** Theme-token fill for a layer's dot. */
export const profileLayerDotClasses: Record<SubagentProfileSource, string> = {
  builtin: "bg-muted-foreground",
  user: "bg-info",
  project: "bg-success",
  conversation: "bg-primary",
};

export type ProfileField = keyof SubagentProfileEntry;

export function profileLabel(profile: SubagentProfileConfiguration): string {
  return (
    profile.effective?.label ??
    profile.local?.label ??
    profile.inherited?.label ??
    profile.name
  );
}

export function profileDescription(
  profile: SubagentProfileConfiguration,
): string | undefined {
  return (
    profile.effective?.description ??
    profile.local?.description ??
    profile.inherited?.description
  );
}

/**
 * The layer that created the profile: the lowest layer contributing any
 * field. A profile must be complete where it is created, so no lower layer
 * can contribute to it.
 */
export function profileOriginLayer(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
): SubagentProfileSource {
  const sources = new Set(Object.values(profile.origins.fields));
  return layerOrder.find((layer) => sources.has(layer)) ?? scope;
}

/** True when the profile was created in this layer, not merely customized. */
export function profileCreatedHere(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
): boolean {
  return profileOriginLayer(profile, scope) === scope;
}

/** Fields this layer sets on a profile it did not create. */
export function profileCustomizedFields(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
): ProfileField[] {
  if (!profile.local || profileCreatedHere(profile, scope)) return [];
  return Object.keys(profile.local) as ProfileField[];
}

const fieldLabels: Record<ProfileField, string> = {
  label: "label",
  description: "description",
  enabled: "availability",
  model: "model",
  thinking: "thinking",
  permission: "permission",
  compaction: "compaction",
  tools: "tools",
  skills: "skills",
  instructions: "instructions",
};

export function profileFieldLabel(field: ProfileField): string {
  return fieldLabels[field];
}

/** Where a field's value comes from, relative to the layer being edited. */
export function profileFieldSource(
  profile: SubagentProfileConfiguration,
  field: ProfileField,
): SubagentProfileSource | undefined {
  return profile.origins.fields[field];
}

export function profileModelLabel(
  model: string | undefined,
  models: readonly ModelInfo[],
): string {
  if (!model || model === "lead") return "Same as lead";
  const match = models.find(
    (item) => `${item.provider}/${item.modelId}` === model,
  );
  return match ? modelDisplayName(match) : model;
}

export function profileThinkingLabel(thinking: string | undefined): string {
  if (!thinking || thinking === "lead") return "Same as lead";
  return thinking.charAt(0).toUpperCase() + thinking.slice(1);
}

export function profilePermissionLabel(permission: string | undefined): string {
  return permission === "read_only" ? "Read-only" : "Autonomous";
}

/** Human labels for tool changes, e.g. "+Jira", "−Web access". */
export function profileToolChanges(tools: SubagentProfile["tools"]): string[] {
  const names = Object.keys(tools).filter(
    (name) => capabilityToolNameSchema.safeParse(name).success,
  ) as Parameters<typeof capabilityToolGroupsFor>[0];
  return capabilityToolGroupsFor(names).flatMap((group) => {
    const values = group.names.map((name) => tools[name]);
    if (values.every((value) => value === false)) return [`−${group.label}`];
    if (values.every((value) => value !== false)) return [`+${group.label}`];
    return [];
  });
}

export function profileSkillsLabel(
  skills: SubagentProfile["skills"] | undefined,
): string {
  if (skills === undefined || skills === "inherit") return "Same as lead";
  if (skills === "none") return "No skills";
  const changes = Object.keys(skills).length;
  return `${changes} skill change${changes === 1 ? "" : "s"}`;
}

/**
 * One line of differences from the lead: model, thinking, permission, then
 * tool and skill changes. "Same as lead" values are omitted, except a lone
 * model so the line is never empty.
 */
export function profileSummaryParts(
  profile: SubagentProfile,
  models: readonly ModelInfo[],
): string[] {
  const parts = [profileModelLabel(profile.model, models)];
  if (profile.thinking !== "lead")
    parts.push(`${profileThinkingLabel(profile.thinking)} thinking`);
  parts.push(profilePermissionLabel(profile.permission));
  parts.push(...profileToolChanges(profile.tools));
  if (profile.skills !== "inherit")
    parts.push(profileSkillsLabel(profile.skills));
  return parts;
}

/** Short display of one field value, for revert hints and the layers table. */
export function profileFieldValueLabel(
  field: ProfileField,
  value: unknown,
  models: readonly ModelInfo[],
): string {
  if (value === undefined) return "—";
  switch (field) {
    case "model":
      return profileModelLabel(value as string, models);
    case "thinking":
      return profileThinkingLabel(value as string);
    case "permission":
      return profilePermissionLabel(value as string);
    case "enabled":
      return value ? "On" : "Off";
    case "compaction":
      return value === "inherit"
        ? "Same as lead"
        : `${(value as { profile: string }).profile} profile`;
    case "tools": {
      const changes = profileToolChanges(value as SubagentProfile["tools"]);
      return changes.length ? changes.join(", ") : "Same as lead";
    }
    case "skills":
      return profileSkillsLabel(value as SubagentProfile["skills"]);
    default:
      return String(value);
  }
}
