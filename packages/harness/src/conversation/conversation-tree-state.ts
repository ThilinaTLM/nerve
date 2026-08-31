import { ConversationError } from "../errors.js";
import {
  buildContextMessages,
  buildConversationContext,
  type ConversationContext,
  type ConversationState,
} from "./context.js";
import type { ConversationTreeEntry, LeafEntry } from "./entries.js";
import {
  entryLinkError,
  generateEntryId,
  type EntryIdStyle,
  leafIdAfterEntry,
  updateLabelCache,
} from "./storage-utils.js";

/** Backend-neutral owner of conversation-tree invariants and projections. */
const initialState = (): ConversationState => ({
  thinkingLevel: "off",
  model: null,
  activeToolNames: null,
  compaction: null,
});

function deriveState(
  previous: ConversationState | undefined,
  entry: ConversationTreeEntry,
): ConversationState {
  const state = previous ?? initialState();
  if (entry.type === "thinking_level_change") {
    return { ...state, thinkingLevel: entry.thinkingLevel };
  }
  if (entry.type === "model_change") {
    return {
      ...state,
      model: { provider: entry.provider, modelId: entry.modelId },
    };
  }
  if (entry.type === "message" && entry.message.role === "assistant") {
    return {
      ...state,
      model: { provider: entry.message.provider, modelId: entry.message.model },
    };
  }
  if (entry.type === "active_tools_change") {
    return { ...state, activeToolNames: [...entry.activeToolNames] };
  }
  if (entry.type === "compaction") return { ...state, compaction: entry };
  return state;
}

export class ConversationTreeState {
  readonly #entries: ConversationTreeEntry[];
  readonly #byId = new Map<string, ConversationTreeEntry>();
  readonly #labelsById = new Map<string, string>();
  readonly #stateById = new Map<string, ConversationState>();
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
    this.#stateById.set(
      entry.id,
      deriveState(this.#stateById.get(entry.parentId ?? ""), entry),
    );
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
      path.push(current);
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
    return path.reverse();
  }

  setLeafId(leafId: string | null): void {
    if (leafId !== null && !this.#byId.has(leafId)) {
      throw new ConversationError("not_found", `Entry ${leafId} not found`);
    }
    this.#leafId = leafId;
  }

  buildContext(leafId: string | null = this.leafId): ConversationContext {
    if (leafId === null) return buildConversationContext([]);
    const state = this.#stateById.get(leafId);
    if (!state?.compaction) {
      return buildConversationContext(this.getPathToRoot(leafId));
    }
    const path = this.getContextPath(leafId);
    return {
      messages: buildContextMessages(path, state),
      thinkingLevel: state.thinkingLevel,
      model: state.model,
      activeToolNames: state.activeToolNames,
    };
  }

  getContextPath(leafId: string | null = this.leafId): ConversationTreeEntry[] {
    if (leafId === null) return [];
    const compaction = this.#stateById.get(leafId)?.compaction;
    if (!compaction) return this.getPathToRoot(leafId);
    const retained: ConversationTreeEntry[] = [];
    let cursor = compaction.parentId
      ? this.#byId.get(compaction.parentId)
      : undefined;
    while (cursor) {
      retained.push(cursor);
      if (cursor.id === compaction.firstKeptEntryId) break;
      cursor = cursor.parentId ? this.#byId.get(cursor.parentId) : undefined;
    }
    if (retained.at(-1)?.id !== compaction.firstKeptEntryId)
      retained.length = 0;
    retained.reverse();

    const trailing: ConversationTreeEntry[] = [];
    cursor = this.#byId.get(leafId);
    while (cursor && cursor.id !== compaction.id) {
      trailing.push(cursor);
      cursor = cursor.parentId ? this.#byId.get(cursor.parentId) : undefined;
    }
    trailing.reverse();
    return [...retained, compaction, ...trailing];
  }

  entries(): ConversationTreeEntry[] {
    return [...this.#entries];
  }
}
