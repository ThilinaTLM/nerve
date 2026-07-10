import type { FileSystem } from "../env/types.js";
import { ConversationError } from "../errors.js";
import { toError } from "../result.js";
import type {
  Conversation,
  JsonlConversationCreateOptions,
  JsonlConversationListOptions,
  JsonlConversationMetadata,
  JsonlConversationRepoApi,
} from "./entries.js";
import {
  JsonlConversationStorage,
  loadJsonlConversationMetadata,
} from "./jsonl-storage.js";
import {
  createConversationId,
  createTimestamp,
  getEntriesToFork,
  getFileSystemResultOrThrow,
  toConversation,
} from "./repo-utils.js";

type JsonlConversationRepoFileSystem = Pick<
  FileSystem,
  | "cwd"
  | "absolutePath"
  | "joinPath"
  | "readTextFile"
  | "readTextLines"
  | "writeFile"
  | "appendFile"
  | "listDir"
  | "exists"
  | "createDir"
  | "remove"
>;

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export class JsonlConversationRepo implements JsonlConversationRepoApi {
  private readonly fs: JsonlConversationRepoFileSystem;
  private readonly conversationsRootInput: string;
  private conversationsRoot: string | undefined;

  constructor(options: {
    fs: JsonlConversationRepoFileSystem;
    conversationsRoot: string;
  }) {
    this.fs = options.fs;
    this.conversationsRootInput = options.conversationsRoot;
  }

  private async getConversationsRoot(): Promise<string> {
    if (!this.conversationsRoot) {
      this.conversationsRoot = getFileSystemResultOrThrow(
        await this.fs.absolutePath(this.conversationsRootInput),
        `Failed to resolve conversations root ${this.conversationsRootInput}`,
      );
    }
    return this.conversationsRoot;
  }

  private async getConversationDir(cwd: string): Promise<string> {
    return getFileSystemResultOrThrow(
      await this.fs.joinPath([
        await this.getConversationsRoot(),
        encodeCwd(cwd),
      ]),
      `Failed to resolve conversation directory for ${cwd}`,
    );
  }

  private async createConversationFilePath(
    cwd: string,
    conversationId: string,
    timestamp: string,
  ): Promise<string> {
    return getFileSystemResultOrThrow(
      await this.fs.joinPath([
        await this.getConversationDir(cwd),
        `${timestamp.replace(/[:.]/g, "-")}_${conversationId}.jsonl`,
      ]),
      `Failed to resolve conversation file path for ${conversationId}`,
    );
  }

  async create(
    options: JsonlConversationCreateOptions,
  ): Promise<Conversation<JsonlConversationMetadata>> {
    const id = options.id ?? createConversationId();
    const createdAt = createTimestamp();
    const conversationDir = await this.getConversationDir(options.cwd);
    getFileSystemResultOrThrow(
      await this.fs.createDir(conversationDir, { recursive: true }),
      `Failed to create conversation directory ${conversationDir}`,
    );
    const filePath = await this.createConversationFilePath(
      options.cwd,
      id,
      createdAt,
    );
    const storage = await JsonlConversationStorage.create(this.fs, filePath, {
      cwd: options.cwd,
      conversationId: id,
      parentConversationPath: options.parentConversationPath,
    });
    return toConversation(storage);
  }

  async open(
    metadata: JsonlConversationMetadata,
  ): Promise<Conversation<JsonlConversationMetadata>> {
    if (
      !getFileSystemResultOrThrow(
        await this.fs.exists(metadata.path),
        `Failed to check conversation ${metadata.path}`,
      )
    ) {
      throw new ConversationError(
        "not_found",
        `Conversation not found: ${metadata.path}`,
      );
    }
    const storage = await JsonlConversationStorage.open(this.fs, metadata.path);
    return toConversation(storage);
  }

  async list(
    options: JsonlConversationListOptions = {},
  ): Promise<JsonlConversationMetadata[]> {
    const dirs = options.cwd
      ? [await this.getConversationDir(options.cwd)]
      : await this.listConversationDirs();
    const conversations: JsonlConversationMetadata[] = [];
    for (const dir of dirs) {
      if (
        !getFileSystemResultOrThrow(
          await this.fs.exists(dir),
          `Failed to check conversation directory ${dir}`,
        )
      ) {
        continue;
      }
      const files = getFileSystemResultOrThrow(
        await this.fs.listDir(dir),
        `Failed to list conversations in ${dir}`,
      ).filter(
        (file) => file.kind !== "directory" && file.name.endsWith(".jsonl"),
      );
      for (const file of files) {
        try {
          conversations.push(
            await loadJsonlConversationMetadata(this.fs, file.path),
          );
        } catch (error) {
          const cause = toError(error);
          if (
            !(cause instanceof ConversationError) ||
            cause.code !== "invalid_conversation"
          )
            throw cause;
        }
      }
    }
    conversations.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return conversations;
  }

  async delete(metadata: JsonlConversationMetadata): Promise<void> {
    getFileSystemResultOrThrow(
      await this.fs.remove(metadata.path, { force: true }),
      `Failed to delete conversation ${metadata.path}`,
    );
  }

  async fork(
    sourceMetadata: JsonlConversationMetadata,
    options: JsonlConversationCreateOptions & {
      entryId?: string;
      position?: "before" | "at";
      id?: string;
    },
  ): Promise<Conversation<JsonlConversationMetadata>> {
    const source = await this.open(sourceMetadata);
    const forkedEntries = await getEntriesToFork(source.getStorage(), options);
    const id = options.id ?? createConversationId();
    const createdAt = createTimestamp();
    const conversationDir = await this.getConversationDir(options.cwd);
    getFileSystemResultOrThrow(
      await this.fs.createDir(conversationDir, { recursive: true }),
      `Failed to create conversation directory ${conversationDir}`,
    );
    const storage = await JsonlConversationStorage.create(
      this.fs,
      await this.createConversationFilePath(options.cwd, id, createdAt),
      {
        cwd: options.cwd,
        conversationId: id,
        parentConversationPath:
          options.parentConversationPath ?? sourceMetadata.path,
      },
    );
    for (const entry of forkedEntries) {
      await storage.appendEntry(entry);
    }
    return toConversation(storage);
  }

  private async listConversationDirs(): Promise<string[]> {
    const conversationsRoot = await this.getConversationsRoot();
    if (
      !getFileSystemResultOrThrow(
        await this.fs.exists(conversationsRoot),
        `Failed to check conversations root ${conversationsRoot}`,
      )
    ) {
      return [];
    }
    const entries = getFileSystemResultOrThrow(
      await this.fs.listDir(conversationsRoot),
      `Failed to list conversations root ${conversationsRoot}`,
    );
    return entries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.path);
  }
}
