import { SessionError } from "../errors.js";
import type {
  LeafEntry,
  SessionMetadata,
  SessionStorage,
  SessionTreeEntry,
} from "./entries.js";
import {
  buildLabelsById,
  generateEntryId,
  leafIdAfterEntry,
  updateLabelCache,
} from "./storage-utils.js";
import { uuidv7 } from "./uuid.js";

export class InMemorySessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> implements SessionStorage<TMetadata>
{
  private readonly metadata: TMetadata;
  private entries: SessionTreeEntry[];
  private byId: Map<string, SessionTreeEntry>;
  private labelsById: Map<string, string>;
  private leafId: string | null;

  constructor(options?: {
    entries?: SessionTreeEntry[];
    metadata?: TMetadata;
  }) {
    this.entries = options?.entries ? [...options.entries] : [];
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    this.labelsById = buildLabelsById(this.entries);
    this.leafId = null;
    for (const entry of this.entries) this.leafId = leafIdAfterEntry(entry);
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError(
        "invalid_session",
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
      throw new SessionError(
        "invalid_session",
        `Entry ${this.leafId} not found`,
      );
    }
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
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

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.leafId = leafIdAfterEntry(entry);
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> =>
        entry.type === type,
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.labelsById.get(id);
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) return [];
    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current)
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    while (current) {
      path.unshift(current);
      if (!current.parentId) break;
      const parent = this.byId.get(current.parentId);
      if (!parent)
        throw new SessionError(
          "invalid_session",
          `Entry ${current.parentId} not found`,
        );
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }
}
