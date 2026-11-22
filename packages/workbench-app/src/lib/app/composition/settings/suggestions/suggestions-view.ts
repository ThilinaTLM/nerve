import type {
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
} from "@nervekit/contracts/prompt-suggestions";
import type {
  Layered,
  SettingLayer,
} from "$lib/features/settings/state/layered";
import { applyLayerChange } from "$lib/features/settings/views/shared/layer-change";

/** The stored choices of one suggestion. A project-defined one has no User layer. */
export function suggestionLayers(
  status: PromptSuggestionStatus,
): Layered<boolean> {
  return {
    builtinDefault: status.defaultEnabled,
    user: status.sourceKind === "project" ? undefined : status.userEnabled,
    project: status.projectEnabled,
  };
}

/** What each switch shows: User's value and the project's (User's while it follows). */
export function suggestionSwitches(status: PromptSuggestionStatus) {
  const user = status.userEnabled ?? status.defaultEnabled;
  return {
    user,
    project: status.projectEnabled ?? user,
    projectSet: status.projectEnabled !== undefined,
  };
}

/** The layer writes a switch change needs (a project change that equals User's clears the project choice). */
export async function suggestionWrites(
  status: PromptSuggestionStatus,
  layer: SettingLayer,
  next: boolean,
  projectId: string | undefined,
): Promise<UpdatePromptSuggestionEnabledRequest[]> {
  const writes: UpdatePromptSuggestionEnabledRequest[] = [];
  await applyLayerChange({
    value: suggestionLayers(status),
    layer,
    next,
    writeUser: (choice) => {
      writes.push({
        definitionKey: status.definitionKey,
        enabled: choice ?? null,
        scope: "user",
      });
    },
    writeProject: (choice) => {
      if (!projectId) throw new Error("Open a project first.");
      writes.push({
        definitionKey: status.definitionKey,
        enabled: choice ?? null,
        scope: "project",
        projectId,
      });
    },
  });
  return writes;
}

export type TrustBadge = {
  text: string;
  tip: string;
  variant: "neutral" | "success" | "warning" | "destructive";
};

/** The JavaScript-condition badge of a suggestion row. */
export function trustBadge(status: PromptSuggestionStatus): TrustBadge {
  switch (status.status) {
    case "not_required":
      return {
        text: "No JS",
        tip: "Shows on plain conditions; runs no script.",
        variant: "neutral",
      };
    case "allowed":
      return {
        text: "Allowed",
        tip: "You allowed its script to decide when it shows.",
        variant: "success",
      };
    case "denied":
      return {
        text: "Denied",
        tip: "You denied its script, so the suggestion never shows.",
        variant: "destructive",
      };
    default:
      return {
        text: "Unset",
        tip: "Its script waits for your review.",
        variant: "warning",
      };
  }
}

/** A script that was never reviewed (or changed since): the row asks for a review and has no switches. */
export function awaitsScriptReview(status: PromptSuggestionStatus): boolean {
  return (
    status.requiresTrust &&
    (status.status === "unset" || status.status === "stale")
  );
}
