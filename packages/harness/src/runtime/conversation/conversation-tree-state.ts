import { ConversationError } from "../errors.js";
import type { ConversationTreeEntry, LeafEntry } from "./entries.js";
import {
  entryLinkError,
  generateEntryId,
  type EntryIdStyle,
  leafIdAfterEntry,
  updateLabelCache,
} from "./storage-utils.js";

/** Backend-neutral owner of conversation-tree invariants and projections. */
export class ConversationTreeState {
  readonly #entries: ConversationTreeEntry[];
  readonly #byId = new Map<string, ConversationTreeEntry>();
  readonly #labelsById = new Map<string, string>();
  #leafId: string | null = null;

  constructor(entries: readonly ConversationTreeEntry[] = []) {
    this.#entries = [];
    for (const entry of entries) this.append(entry);
  }

  get leafId(): string | null {
    if (this.#leafId !== null && !this.#byId.has(this.#leafId)) {
      throw new ConversationError(
        "invalid_conversation",
        `Entry ${this.#leafId} not found`,
      );
    }
    return this.#leafId;
  }

  createEntryId(style: EntryIdStyle = "jsonl"): string {
    return generateEntryId(this.#byId, { style });
  }

  createLeafEntry(targetId: string | null): LeafEntry {
    if (targetId !== null && !this.#byId.has(targetId)) {
      throw new ConversationError("not_found", `Entry ${targetId} not found`);
    }
    return {
      type: "leaf",
      id: this.createEntryId(),
      parentId: this.#leafId,
      timestamp: new Date().toISOString(),
      targetId,
    };
  }

  validateAppend(entry: ConversationTreeEntry): void {
    const linkError = entryLinkError(entry, this.#byId);
    if (linkError) {
      throw new ConversationError("invalid_conversation", linkError);
    }
  }

  append(entry: ConversationTreeEntry): void {
    this.validateAppend(entry);
    this.#entries.push(entry);
    this.#byId.set(entry.id, entry);
    updateLabelCache(this.#labelsById, entry);
    this.#leafId = leafIdAfterEntry(entry);
  }

  getEntry(id: string): ConversationTreeEntry | undefined {
    return this.#byId.get(id);
  }

  findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Array<Extract<ConversationTreeEntry, { type: TType }>> {
    return this.#entries.filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: TType }> =>
        entry.type === type,
    );
  }

  getLabel(id: string): string | undefined {
    return this.#labelsById.get(id);
  }

  getPathToRoot(leafId: string | null): ConversationTreeEntry[] {
    if (leafId === null) return [];
    const path: ConversationTreeEntry[] = [];
    let current = this.#byId.get(leafId);
    if (!current)
      throw new ConversationError("not_found", `Entry ${leafId} not found`);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id)) {
        throw new ConversationError(
          "invalid_conversation",
          `Cycle detected at entry ${current.id}`,
        );
      }
      visited.add(current.id);
      path.unshift(current);
      if (!current.parentId) break;
      const parent = this.#byId.get(current.parentId);
      if (!parent) {
        throw new ConversationError(
          "invalid_conversation",
          `Entry ${current.parentId} not found`,
        );
      }
      current = parent;
    }
    return path;
  }

  entries(): ConversationTreeEntry[] {
    return [...this.#entries];
  }
}
