export interface LegacyConversationEntryRow {
  data: Uint8Array | string | null;
  model_entry_id: string | null;
  model_parent_entry_id: string | null;
}

/** Reconnects retained public entries across model-only legacy ancestors. */
export function repairLegacyConversationEntryParents(
  entries: readonly Record<string, unknown>[],
  rows: readonly LegacyConversationEntryRow[],
): Record<string, unknown>[] {
  const includedIds = new Set(
    entries.flatMap((entry) =>
      typeof entry.id === "string" ? [entry.id] : [],
    ),
  );
  const modelParents = new Map(
    rows.flatMap((row) =>
      row.model_entry_id
        ? [[row.model_entry_id, row.model_parent_entry_id] as const]
        : [],
    ),
  );
  return entries.map((entry) => {
    if (
      typeof entry.parentEntryId !== "string" ||
      includedIds.has(entry.parentEntryId)
    ) {
      return entry;
    }
    let parentEntryId: string | null = entry.parentEntryId;
    const visited = new Set<string>();
    while (
      parentEntryId &&
      !includedIds.has(parentEntryId) &&
      modelParents.has(parentEntryId) &&
      !visited.has(parentEntryId)
    ) {
      visited.add(parentEntryId);
      parentEntryId = modelParents.get(parentEntryId) ?? null;
    }
    if (parentEntryId === entry.parentEntryId) return entry;
    if (parentEntryId) return { ...entry, parentEntryId };
    const root = { ...entry };
    delete root.parentEntryId;
    return root;
  });
}
