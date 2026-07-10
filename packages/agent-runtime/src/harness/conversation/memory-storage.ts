import { ConversationError } from "../errors.js";
import type {
  ConversationMetadata,
  ConversationStorage,
  ConversationTreeEntry,
  LeafEntry,
} from "./entries.js";
import {
  buildLabelsById,
  generateEntryId,
  leafIdAfterEntry,
  updateLabelCache,
} from "./storage-utils.js";
import { uuidv7 } from "./uuid.js";

export class InMemoryConversationStorage<
  TMetadata extends ConversationMetadata = ConversationMetadata,
> implements ConversationStorage<TMetadata>
{
  private readonly metadata: TMetadata;
  private entries: ConversationTreeEntry[];
  private byId: Map<string, ConversationTreeEntry>;
  private labelsById: Map<string, string>;
  private leafId: string | null;

  constructor(options?: {
    entries?: ConversationTreeEntry[];
    metadata?: TMetadata;
  }) {
    this.entries = options?.entries ? [...options.entries] : [];
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    this.labelsById = buildLabelsById(this.entries);
    this.leafId = null;
    for (const entry of this.entries) this.leafId = leafIdAfterEntry(entry);
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new ConversationError(
        "invalid_conversation",
        `Entry ${this.leafId} not found`,
      );
    }
    this.metadata =
      options?.metadata ??
      ({ id: uuidv7(), createdAt: new Date().toISOString() } as TMetadata);
  }

  async getMetadata(): Promise<TMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new ConversationError(
        "invalid_conversation",
        `Entry ${this.leafId} not found`,
      );
    }
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new ConversationError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateEntryId(this.byId, { style: "short" }),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = leafId;
  }

  async createEntryId(): Promise<string> {
    return generateEntryId(this.byId, { style: "short" });
  }

  async appendEntry(entry: ConversationTreeEntry): Promise<void> {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.leafId = leafIdAfterEntry(entry);
  }

  async getEntry(id: string): Promise<ConversationTreeEntry | undefined> {
    return this.byId.get(id);
  }

  async findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<ConversationTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: TType }> =>
        entry.type === type,
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.labelsById.get(id);
  }

  async getPathToRoot(leafId: string | null): Promise<ConversationTreeEntry[]> {
    if (leafId === null) return [];
    const path: ConversationTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current)
      throw new ConversationError("not_found", `Entry ${leafId} not found`);
    while (current) {
      path.unshift(current);
      if (!current.parentId) break;
      const parent = this.byId.get(current.parentId);
      if (!parent)
        throw new ConversationError(
          "invalid_conversation",
          `Entry ${current.parentId} not found`,
        );
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<ConversationTreeEntry[]> {
    return [...this.entries];
  }
}
