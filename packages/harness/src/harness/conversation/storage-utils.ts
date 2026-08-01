import type { ConversationTreeEntry } from "./entries.js";
import { uuidv7 } from "./uuid.js";

export type EntryIdStyle = "jsonl" | "short";

export function updateLabelCache(
  labelsById: Map<string, string>,
  entry: ConversationTreeEntry,
): void {
  if (entry.type !== "label") return;
  const label = entry.label?.trim();
  if (label) {
    labelsById.set(entry.targetId, label);
  } else {
    labelsById.delete(entry.targetId);
  }
}

export function buildLabelsById(
  entries: ConversationTreeEntry[],
): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}

export function leafIdAfterEntry(entry: ConversationTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

export function entryLinkError(
  entry: ConversationTreeEntry,
  knownIds: { has(id: string): boolean },
): string | undefined {
  if (knownIds.has(entry.id)) return `Duplicate entry id ${entry.id}`;
  if (entry.parentId !== null && !knownIds.has(entry.parentId)) {
    return `Entry ${entry.id} references missing parent ${entry.parentId}`;
  }
  if (
    entry.type === "leaf" &&
    entry.targetId !== null &&
    !knownIds.has(entry.targetId)
  ) {
    return `Entry ${entry.id} references missing leaf target ${entry.targetId}`;
  }
  return undefined;
}

export function generateEntryId(
  byId: { has(id: string): boolean },
  options: { style?: EntryIdStyle } = {},
): string {
  const style = options.style ?? "jsonl";
  for (let i = 0; i < 100; i++) {
    const id = style === "short" ? uuidv7().slice(0, 8) : `entry_${uuidv7()}`;
    if (!byId.has(id)) return id;
  }
  return style === "short" ? uuidv7() : `entry_${uuidv7()}`;
}
