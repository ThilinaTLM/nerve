import type { FileSystem } from "../environment/types.js";
import type {
  ConversationStorage,
  ConversationTreeEntry,
  JsonlConversationMetadata,
} from "./entries.js";
import { ConversationTreeState } from "./conversation-tree-state.js";
import { getFileSystemResultOrThrow } from "./repo-utils.js";
import {
  headerToConversationMetadata,
  invalidConversation,
  invalidEntry,
  parseEntryLine,
  parseHeaderLine,
  serializeJsonlEntry,
  serializeJsonlHeader,
  type ConversationHeader,
} from "./jsonl-codec.js";

type JsonlConversationStorageFileSystem = Pick<
  FileSystem,
  "readTextFile" | "readTextLines" | "writeFile" | "appendFile"
>;

export async function loadJsonlConversationMetadata(
  fs: JsonlConversationStorageFileSystem,
  filePath: string,
): Promise<JsonlConversationMetadata> {
  const lines = getFileSystemResultOrThrow(
    await fs.readTextLines(filePath, { maxLines: 1 }),
    `Failed to read conversation header ${filePath}`,
  );
  const line = lines[0];
  if (line?.trim())
    return headerToConversationMetadata(
      parseHeaderLine(line, filePath),
      filePath,
    );
  throw invalidConversation(filePath, "missing conversation header");
}

async function loadJsonlStorage(
  fs: JsonlConversationStorageFileSystem,
  filePath: string,
): Promise<{
  header: ConversationHeader;
  entries: ConversationTreeEntry[];
}> {
  const content = getFileSystemResultOrThrow(
    await fs.readTextFile(filePath),
    `Failed to read conversation ${filePath}`,
  );
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    throw invalidConversation(filePath, "missing conversation header");
  }

  const headerLine = lines[0];
  if (!headerLine) {
    throw invalidConversation(filePath, "missing conversation header");
  }
  const header = parseHeaderLine(headerLine, filePath);
  const entries: ConversationTreeEntry[] = [];
  const seenIds = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lineNumber = i + 1;
    const entry = parseEntryLine(line, filePath, lineNumber);
    if (seenIds.has(entry.id)) {
      throw invalidEntry(
        filePath,
        lineNumber,
        `duplicates entry id '${entry.id}'`,
      );
    }
    if (entry.parentId !== null && !seenIds.has(entry.parentId)) {
      throw invalidEntry(
        filePath,
        lineNumber,
        `references missing or forward parent '${entry.parentId}'`,
      );
    }
    if (
      entry.type === "leaf" &&
      entry.targetId !== null &&
      !seenIds.has(entry.targetId)
    ) {
      throw invalidEntry(
        filePath,
        lineNumber,
        `references missing or forward leaf target '${entry.targetId}'`,
      );
    }
    seenIds.add(entry.id);
    entries.push(entry);
  }
  return { header, entries };
}

export class JsonlConversationStorage implements ConversationStorage<JsonlConversationMetadata> {
  private readonly fs: JsonlConversationStorageFileSystem;
  private readonly filePath: string;
  private readonly metadata: JsonlConversationMetadata;
  private readonly tree: ConversationTreeState;

  private constructor(
    fs: JsonlConversationStorageFileSystem,
    filePath: string,
    header: ConversationHeader,
    entries: ConversationTreeEntry[],
  ) {
    this.fs = fs;
    this.filePath = filePath;
    this.metadata = headerToConversationMetadata(header, this.filePath);
    this.tree = new ConversationTreeState(entries);
  }

  static async open(
    fs: JsonlConversationStorageFileSystem,
    filePath: string,
  ): Promise<JsonlConversationStorage> {
    const loaded = await loadJsonlStorage(fs, filePath);
    return new JsonlConversationStorage(
      fs,
      filePath,
      loaded.header,
      loaded.entries,
    );
  }

  static async create(
    fs: JsonlConversationStorageFileSystem,
    filePath: string,
    options: {
      cwd: string;
      conversationId: string;
      parentConversationPath?: string;
    },
  ): Promise<JsonlConversationStorage> {
    const header: ConversationHeader = {
      type: "conversation",
      version: 3,
      id: options.conversationId,
      timestamp: new Date().toISOString(),
      cwd: options.cwd,
      parentConversation: options.parentConversationPath,
    };
    getFileSystemResultOrThrow(
      await fs.writeFile(filePath, serializeJsonlHeader(header)),
      `Failed to create conversation ${filePath}`,
    );
    return new JsonlConversationStorage(fs, filePath, header, []);
  }

  async getMetadata(): Promise<JsonlConversationMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    return this.tree.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    const entry = this.tree.createLeafEntry(leafId);
    getFileSystemResultOrThrow(
      await this.fs.appendFile(this.filePath, serializeJsonlEntry(entry)),
      `Failed to append conversation leaf ${entry.id}`,
    );
    this.tree.append(entry);
  }

  async createEntryId(): Promise<string> {
    return this.tree.createEntryId();
  }

  async appendEntry(entry: ConversationTreeEntry): Promise<void> {
    this.tree.validateAppend(entry);
    getFileSystemResultOrThrow(
      await this.fs.appendFile(this.filePath, serializeJsonlEntry(entry)),
      `Failed to append conversation entry ${entry.id}`,
    );
    this.tree.append(entry);
  }

  async getEntry(id: string): Promise<ConversationTreeEntry | undefined> {
    return this.tree.getEntry(id);
  }

  async findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<ConversationTreeEntry, { type: TType }>>> {
    return this.tree.findEntries(type);
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.tree.getLabel(id);
  }

  async getPathToRoot(leafId: string | null): Promise<ConversationTreeEntry[]> {
    return this.tree.getPathToRoot(leafId);
  }

  async getEntries(): Promise<ConversationTreeEntry[]> {
    return this.tree.entries();
  }
}
