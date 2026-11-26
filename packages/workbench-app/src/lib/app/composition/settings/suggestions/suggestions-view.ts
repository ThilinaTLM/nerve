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

/** The decision on a suggestion file; undefined when it has none to decide. */
export function suggestionTrustState(
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

/** The badge of a suggestion row: the shared decision states, or "No JS" for one that needs none. */
export function trustBadge(status: PromptSuggestionStatus): TrustBadge {
  const state = suggestionTrustState(status);
  if (!state)
    return {
      text: "No JS",
      tip: "Shows on plain conditions; runs no script.",
      variant: "neutral",
    };
  const tips: Record<TrustState, string> = {
    needs_review:
      status.status === "stale"
        ? "Changed outside Nerve's settings since you decided. Not shown until you review it."
        : "Not shown until you review and trust it.",
    trusted:
      "You trusted this exact file. Edits made in Nerve keep it trusted; any other change asks again.",
    declined: "You declined it, so the suggestion never shows.",
  };
  return {
    text: TRUST_STATE_LABELS[state],
    tip: tips[state],
    variant: TRUST_STATE_TONES[state],
  };
}

/** A file that was never reviewed (or changed since): the row asks for a review and has no switches. */
export function awaitsReview(status: PromptSuggestionStatus): boolean {
  return (
    status.requiresTrust &&
    (status.status === "needs_review" || status.status === "stale")
  );
}
