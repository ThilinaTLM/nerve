import type { FileSystem } from "../env/types.js";
import { ConversationError } from "../errors.js";
import { toError } from "../result.js";
import type {
  ConversationStorage,
  ConversationTreeEntry,
  JsonlConversationMetadata,
  LeafEntry,
} from "./entries.js";
import { getFileSystemResultOrThrow } from "./repo-utils.js";
import {
  buildLabelsById,
  generateEntryId,
  leafIdAfterEntry,
  updateLabelCache,
} from "./storage-utils.js";

type JsonlConversationStorageFileSystem = Pick<
  FileSystem,
  "readTextFile" | "readTextLines" | "writeFile" | "appendFile"
>;

interface ConversationHeader {
  type: "conversation";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  parentConversation?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidConversation(
  filePath: string,
  message: string,
  cause?: Error,
): ConversationError {
  return new ConversationError(
    "invalid_conversation",
    `Invalid JSONL conversation file ${filePath}: ${message}`,
    cause,
  );
}

function invalidEntry(
  filePath: string,
  lineNumber: number,
  message: string,
  cause?: Error,
): ConversationError {
  return new ConversationError(
    "invalid_entry",
    `Invalid JSONL conversation file ${filePath}: line ${lineNumber} ${message}`,
    cause,
  );
}

function parseHeaderLine(line: string, filePath: string): ConversationHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidConversation(
      filePath,
      "first line is not a valid conversation header",
      toError(error),
    );
  }
  if (!isRecord(parsed))
    throw invalidConversation(
      filePath,
      "first line is not a valid conversation header",
    );
  if (parsed.type !== "conversation")
    throw invalidConversation(
      filePath,
      "first line is not a valid conversation header",
    );
  if (parsed.version !== 3)
    throw invalidConversation(filePath, "unsupported conversation version");
  if (typeof parsed.id !== "string" || !parsed.id)
    throw invalidConversation(filePath, "conversation header is missing id");
  if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
    throw invalidConversation(
      filePath,
      "conversation header is missing timestamp",
    );
  }
  if (typeof parsed.cwd !== "string" || !parsed.cwd)
    throw invalidConversation(filePath, "conversation header is missing cwd");
  if (
    parsed.parentConversation !== undefined &&
    typeof parsed.parentConversation !== "string"
  ) {
    throw invalidConversation(
      filePath,
      "conversation header parentConversation must be a string",
    );
  }
  return {
    type: "conversation",
    version: 3,
    id: parsed.id,
    timestamp: parsed.timestamp,
    cwd: parsed.cwd,
    parentConversation: parsed.parentConversation,
  };
}

function parseEntryLine(
  line: string,
  filePath: string,
  lineNumber: number,
): ConversationTreeEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidEntry(
      filePath,
      lineNumber,
      "is not valid JSON",
      toError(error),
    );
  }
  if (!isRecord(parsed))
    throw invalidEntry(
      filePath,
      lineNumber,
      "is not a valid conversation entry",
    );
  if (typeof parsed.type !== "string")
    throw invalidEntry(filePath, lineNumber, "is missing entry type");
  if (typeof parsed.id !== "string" || !parsed.id)
    throw invalidEntry(filePath, lineNumber, "is missing entry id");
  if (parsed.parentId !== null && typeof parsed.parentId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid parentId");
  }
  if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
    throw invalidEntry(filePath, lineNumber, "is missing timestamp");
  }
  if (
    parsed.type === "leaf" &&
    parsed.targetId !== null &&
    typeof parsed.targetId !== "string"
  ) {
    throw invalidEntry(filePath, lineNumber, "has invalid targetId");
  }
  return parsed as unknown as ConversationTreeEntry;
}

function headerToConversationMetadata(
  header: ConversationHeader,
  path: string,
): JsonlConversationMetadata {
  return {
    id: header.id,
    createdAt: header.timestamp,
    cwd: header.cwd,
    path,
    parentConversationPath: header.parentConversation,
  };
}

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
  leafId: string | null;
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
  let leafId: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const entry = parseEntryLine(line, filePath, i + 1);
    entries.push(entry);
    leafId = leafIdAfterEntry(entry);
  }
  return { header, entries, leafId };
}

export class JsonlConversationStorage
  implements ConversationStorage<JsonlConversationMetadata>
{
  private readonly fs: JsonlConversationStorageFileSystem;
  private readonly filePath: string;
  private readonly metadata: JsonlConversationMetadata;
  private entries: ConversationTreeEntry[];
  private byId: Map<string, ConversationTreeEntry>;
  private labelsById: Map<string, string>;
  private currentLeafId: string | null;

  private constructor(
    fs: JsonlConversationStorageFileSystem,
    filePath: string,
    header: ConversationHeader,
    entries: ConversationTreeEntry[],
    leafId: string | null,
  ) {
    this.fs = fs;
    this.filePath = filePath;
    this.metadata = headerToConversationMetadata(header, this.filePath);
    this.entries = entries;
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
    this.labelsById = buildLabelsById(entries);
    this.currentLeafId = leafId;
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
      loaded.leafId,
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
      await fs.writeFile(filePath, `${JSON.stringify(header)}\n`),
      `Failed to create conversation ${filePath}`,
    );
    return new JsonlConversationStorage(fs, filePath, header, [], null);
  }

  async getMetadata(): Promise<JsonlConversationMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    if (this.currentLeafId !== null && !this.byId.has(this.currentLeafId)) {
      throw new ConversationError(
        "invalid_conversation",
        `Entry ${this.currentLeafId} not found`,
      );
    }
    return this.currentLeafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new ConversationError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateEntryId(this.byId),
      parentId: this.currentLeafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    getFileSystemResultOrThrow(
      await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`),
      `Failed to append conversation leaf ${entry.id}`,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.currentLeafId = leafId;
  }

  async createEntryId(): Promise<string> {
    return generateEntryId(this.byId);
  }

  async appendEntry(entry: ConversationTreeEntry): Promise<void> {
    getFileSystemResultOrThrow(
      await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`),
      `Failed to append conversation entry ${entry.id}`,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.currentLeafId = leafIdAfterEntry(entry);
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
