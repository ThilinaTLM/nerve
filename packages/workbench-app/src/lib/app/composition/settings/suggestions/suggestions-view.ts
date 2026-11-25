import type {
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
} from "@nervekit/contracts/prompt-suggestions";
import type { TrustState } from "@nervekit/contracts/core";
import {
  TRUST_STATE_LABELS,
  TRUST_STATE_TONES,
} from "$lib/presentation/settings/trust-state";
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
  variant: "neutral" | "success" | "warning";
};

/** The decision on a suggestion's script; undefined when it has none to decide. */
export function scriptTrustState(
  status: PromptSuggestionStatus,
): TrustState | undefined {
  if (!status.requiresTrust) return undefined;
  switch (status.status) {
    case "trusted":
    case "declined":
    case "needs_review":
      return status.status;
    case "stale":
      return "needs_review";
    case "not_required":
      return undefined;
  }
}

/** The script badge of a suggestion row: the shared decision states, or "No JS". */
export function trustBadge(status: PromptSuggestionStatus): TrustBadge {
  const state = scriptTrustState(status);
  if (!state)
    return {
      text: "No JS",
      tip: "Shows on plain conditions; runs no script.",
      variant: "neutral",
    };
  const tips: Record<TrustState, string> = {
    needs_review:
      status.status === "stale"
        ? "Its script changed since you decided. It waits for your review."
        : "Its script waits for your review.",
    trusted: "You trusted its script to decide when it shows.",
    declined: "You declined its script, so the suggestion never shows.",
  };
  return {
    text: TRUST_STATE_LABELS[state],
    tip: tips[state],
    variant: TRUST_STATE_TONES[state],
  };
}

/** A script that was never reviewed (or changed since): the row asks for a review and has no switches. */
export function awaitsScriptReview(status: PromptSuggestionStatus): boolean {
  return (
    status.requiresTrust &&
    (status.status === "needs_review" || status.status === "stale")
  );
}
