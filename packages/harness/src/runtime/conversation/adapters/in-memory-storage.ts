import type {
  ConversationMetadata,
  ConversationStorage,
  ConversationTreeEntry,
} from "../entries.js";
import { ConversationTreeState } from "../conversation-tree-state.js";
import { uuidv7 } from "../uuid.js";

export class InMemoryConversationStorage<
  TMetadata extends ConversationMetadata = ConversationMetadata,
> implements ConversationStorage<TMetadata> {
  readonly #metadata: TMetadata;
  readonly #tree: ConversationTreeState;

  constructor(options?: {
    entries?: ConversationTreeEntry[];
    metadata?: TMetadata;
  }) {
    this.#tree = new ConversationTreeState(options?.entries);
    this.#metadata =
      options?.metadata ??
      ({ id: uuidv7(), createdAt: new Date().toISOString() } as TMetadata);
  }

  async getMetadata(): Promise<TMetadata> {
    return this.#metadata;
  }

  async getLeafId(): Promise<string | null> {
    return this.#tree.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    const entry = this.#tree.createLeafEntry(leafId);
    this.#tree.append(entry);
  }

  async createEntryId(): Promise<string> {
    return this.#tree.createEntryId("short");
  }

  async appendEntry(entry: ConversationTreeEntry): Promise<void> {
    this.#tree.append(entry);
  }

  async getEntry(id: string): Promise<ConversationTreeEntry | undefined> {
    return this.#tree.getEntry(id);
  }

  async findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<ConversationTreeEntry, { type: TType }>>> {
    return this.#tree.findEntries(type);
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.#tree.getLabel(id);
  }

  async getPathToRoot(leafId: string | null): Promise<ConversationTreeEntry[]> {
    return this.#tree.getPathToRoot(leafId);
  }

  async getEntries(): Promise<ConversationTreeEntry[]> {
    return this.#tree.entries();
  }
}
