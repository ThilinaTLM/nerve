export function isFileDraftDirty(draft: string, baseline: string): boolean {
  return draft !== baseline;
}

export function reconcileSavedFileDraft(input: {
  currentDraft: string;
  savedDraft: string;
  savedText: string;
}): { draft: string; dirty: boolean } {
  if (input.currentDraft === input.savedDraft) {
    return { draft: input.savedText, dirty: false };
  }
  return {
    draft: input.currentDraft,
    dirty: isFileDraftDirty(input.currentDraft, input.savedText),
  };
}
