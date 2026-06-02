import type { SessionTreeEntry } from "../types.js";
import { uuidv7 } from "./uuid.js";

export type EntryIdStyle = "jsonl" | "short";

export function updateLabelCache(
  labelsById: Map<string, string>,
  entry: SessionTreeEntry,
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
  entries: SessionTreeEntry[],
): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}

export function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
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
