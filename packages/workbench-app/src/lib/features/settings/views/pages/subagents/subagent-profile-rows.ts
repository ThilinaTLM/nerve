import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  SubagentProfile,
  SubagentProfileScope,
} from "@nervekit/contracts/subagents";
import { modelDisplayName } from "$lib/presentation/utils/model";

export type ProfileRowState = {
  sourceLabel: string;
  canEdit: boolean;
  canDuplicate: boolean;
  canEnable: boolean;
  canTrust: boolean;
  /** `reset` removes an override of a built-in; `delete` removes a file. */
  remove?: "delete" | "reset";
};

const SOURCE_LABELS = {
  builtin: "Built-in",
  user: "User",
  project: "Project",
} as const;

/**
 * What a profile row offers in the scope being viewed. Shadowed and invalid
 * profiles are never offered to the lead, so they only keep what removes them.
 */
export function profileRowState(
  profile: SubagentProfile,
  scope: SubagentProfileScope,
  builtInNames: ReadonlySet<string>,
): ProfileRowState {
  const usable = !profile.shadowed && !profile.error;
  const untrusted = profile.trust === "untrusted";
  return {
    sourceLabel: SOURCE_LABELS[profile.source],
    canEdit: usable,
    canDuplicate: usable,
    canEnable: usable && !untrusted,
    canTrust: untrusted && profile.source === "project" && !profile.shadowed,
    remove:
      profile.source === scope && !profile.shadowed
        ? builtInNames.has(profile.name)
          ? "reset"
          : "delete"
        : undefined,
  };
}

/** One line: model, thinking level when set, and the permission rule set. */
export function profileSummary(
  profile: SubagentProfile,
  models: readonly ModelInfo[],
): string {
  const parts: string[] = [];
  if (profile.model === "lead") parts.push("Lead's model");
  else {
    const match = models.find(
      (model) => `${model.provider}/${model.modelId}` === profile.model,
    );
    parts.push(match ? modelDisplayName(match) : profile.model);
  }
  if (profile.thinking !== "lead") parts.push(`${profile.thinking} thinking`);
  parts.push(profile.permission === "read_only" ? "Read-only" : "Autonomous");
  return parts.join(" · ");
}
