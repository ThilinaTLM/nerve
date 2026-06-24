import type { LiveToolCallDraft } from "$lib/core/types/state-types";

export function removeDiscardedToolDraft(
  drafts: LiveToolCallDraft[],
  key: string,
  providerToolCallId?: string,
): LiveToolCallDraft[] {
  return drafts.filter(
    (draft) =>
      draft.key !== key &&
      (!providerToolCallId || draft.providerToolCallId !== providerToolCallId),
  );
}
