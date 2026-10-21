import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  AgentProfile,
  AgentProfileCompaction,
  AgentProfileCompactionOverride,
  AgentProfileConfiguration,
  AgentProfileEntry,
  AgentProfileModel,
  AgentProfilePermission,
  AgentProfileScalar,
  AgentProfileScope,
  AgentProfileSource,
  AgentProfileThinking,
  AgentProfileUsableBy,
} from "@nervekit/contracts/agent-profiles";
import { lockedValue } from "@nervekit/contracts/agent-profiles";
import { capabilityToolGroupsFor } from "../composer/capability-tool-labels";
import { modelDisplayName } from "../utils/model";

/**
 * Shared vocabulary for agent profile layers: Settings and the
 * conversation popover name and colour layers the same way.
 */
const layerOrder: readonly AgentProfileSource[] = [
  "builtin",
  "user",
  "project",
  "conversation",
];

export const profileLayerLabels: Record<AgentProfileSource, string> = {
  builtin: "Built-in",
  user: "User",
  project: "Project",
  conversation: "This conversation",
};

/** Theme-token fill for a layer's dot. */
export const profileLayerDotClasses: Record<AgentProfileSource, string> = {
  builtin: "bg-muted-foreground",
  user: "bg-info",
  project: "bg-success",
  conversation: "bg-primary",
};

export type ProfileField = keyof AgentProfileEntry;

export function profileLabel(profile: AgentProfileConfiguration): string {
  return (
    profile.effective?.label ??
    profile.local?.label ??
    profile.inherited?.label ??
    profile.name
  );
}

export function profileDescription(
  profile: AgentProfileConfiguration,
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
  profile: AgentProfileConfiguration,
  scope: AgentProfileScope,
): AgentProfileSource {
  const sources = new Set(Object.values(profile.origins.fields));
  return layerOrder.find((layer) => sources.has(layer)) ?? scope;
}

/** True when the profile was created in this layer, not merely customized. */
export function profileCreatedHere(
  profile: AgentProfileConfiguration,
  scope: AgentProfileScope,
): boolean {
  return profileOriginLayer(profile, scope) === scope;
}

/** Fields this layer sets on a profile it did not create. */
export function profileCustomizedFields(
  profile: AgentProfileConfiguration,
  scope: AgentProfileScope,
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
  usableBy: "availability to",
  permission: "permission",
  compaction: "compaction",
  tools: "tools",
  skills: "skills",
  instructions: "instructions",
};

export const profileUsableByLabels: Record<AgentProfileUsableBy, string> = {
  lead: "Main agent",
  subagent: "Sub-agents",
  both: "Main agent and sub-agents",
};

export function profileFieldLabel(field: ProfileField): string {
  return fieldLabels[field];
}

/** Where a field's value comes from, relative to the layer being edited. */
export function profileFieldSource(
  profile: AgentProfileConfiguration,
  field: ProfileField,
): AgentProfileSource | undefined {
  return profile.origins.fields[field];
}

/** Labels one Inherit/Set/Lock scalar; `label` names a concrete or `default` value. */
function scalarLabel<T extends string>(
  setting: AgentProfileScalar<T> | undefined,
  label: (value: T | "default") => string,
): string {
  if (setting === undefined || setting === "inherit") return "Inherited";
  const locked = lockedValue(setting);
  if (locked !== undefined) return `Locked to ${label(locked)}`;
  return label(setting as T | "default");
}

export function profileModelLabel(
  model: AgentProfileModel | undefined,
  models: readonly ModelInfo[],
): string {
  return scalarLabel(model, (value) => {
    if (value === "default") return "Default model";
    const match = models.find(
      (item) => `${item.provider}/${item.modelId}` === value,
    );
    return match ? modelDisplayName(match) : value;
  });
}

export function profileThinkingLabel(
  thinking: AgentProfileThinking | undefined,
): string {
  return scalarLabel(thinking, (value) =>
    value === "default"
      ? "Default thinking"
      : value.charAt(0).toUpperCase() + value.slice(1),
  );
}

function permissionName(id: string): string {
  if (id === "default") return "Default permissions";
  if (id === "read_only") return "Read-only";
  if (id === "autonomous") return "Autonomous";
  return id;
}

export function profilePermissionLabel(
  permission: AgentProfilePermission | undefined,
): string {
  return scalarLabel(permission, permissionName);
}

export function profileCompactionLabel(
  compaction: AgentProfileCompaction | undefined,
): string {
  if (compaction === undefined || compaction === "inherit") return "Inherited";
  const locked = lockedValue(compaction);
  const value =
    locked ?? (compaction as AgentProfileCompactionOverride | "default");
  const text =
    value === "default" ? "Default compaction" : `${value.profile} profile`;
  return locked === undefined ? text : `Locked to ${text}`;
}

/** Human labels for tool changes, e.g. "+Jira", "−Web access". */
export function profileToolChanges(tools: AgentProfile["tools"]): string[] {
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
  skills: AgentProfile["skills"] | undefined,
): string {
  if (skills === undefined || skills === "inherit") return "Inherited";
  if (skills === "none") return "No skills";
  const changes = Object.keys(skills).length;
  return `${changes} skill change${changes === 1 ? "" : "s"}`;
}

/**
 * One line of what the profile changes: model, thinking, permission, then
 * tool and skill changes. Inherited values are omitted.
 */
export function profileSummaryParts(
  profile: AgentProfile,
  models: readonly ModelInfo[],
): string[] {
  const parts: string[] = [];
  if (profile.model !== "inherit")
    parts.push(profileModelLabel(profile.model, models));
  if (profile.thinking !== "inherit")
    parts.push(`${profileThinkingLabel(profile.thinking)} thinking`);
  if (profile.permission !== "inherit")
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
      return profileModelLabel(value as AgentProfileModel, models);
    case "thinking":
      return profileThinkingLabel(value as AgentProfileThinking);
    case "permission":
      return profilePermissionLabel(value as AgentProfilePermission);
    case "usableBy":
      return profileUsableByLabels[value as AgentProfileUsableBy];
    case "enabled":
      return value ? "On" : "Off";
    case "compaction":
      return profileCompactionLabel(value as AgentProfileCompaction);
    case "tools": {
      const changes = profileToolChanges(value as AgentProfile["tools"]);
      return changes.length ? changes.join(", ") : "Inherited";
    }
    case "skills":
      return profileSkillsLabel(value as AgentProfile["skills"]);
    default:
      return String(value);
  }
}
