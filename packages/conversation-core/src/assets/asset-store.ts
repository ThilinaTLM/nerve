import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createId } from "@nervekit/contracts";
import type { Asset, AssetCategory } from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";

export interface RegisterAsset {
  conversationId: string;
  toolCallId?: string;
  asyncBashId?: string;
  category: AssetCategory;
  logicalPath: string;
  mediaType?: string;
}
export interface WriteAsset extends RegisterAsset {
  content: string | Uint8Array;
}

export class AssetStore {
  readonly dataDir: string;

  constructor(
    dataDir: string,
    private readonly storage: CoreStorage,
  ) {
    this.dataDir = resolve(dataDir);
  }

  path(logicalPath: string): string {
    if (
      !logicalPath ||
      logicalPath.includes("\\") ||
      logicalPath
        .split("/")
        .some((part) => part === ".." || part === "" || part === ".") ||
      /^[A-Za-z]:/.test(logicalPath)
    ) {
      throw new Error("Invalid managed asset path");
    }
    const path = resolve(this.dataDir, logicalPath);
    if (!path.startsWith(`${this.dataDir}${sep}`))
      throw new Error("Asset escapes data directory");
    return path;
  }

  async directory(logicalPath: string): Promise<string> {
    const path = this.path(logicalPath);
    await this.ensureDirectory(path);
    return path;
  }

  async write(input: WriteAsset): Promise<Asset> {
    this.assertOwnership(input);
    const path = this.path(input.logicalPath);
    if (
      this.storage.assets
        .list(input.conversationId)
        .some(
          (asset) =>
            asset.logicalPath === input.logicalPath && asset.eventId !== null,
        )
    )
      throw new Error("Cannot overwrite an event-linked asset");
    await this.ensureDirectory(dirname(path));
    const temp = `${path}.${createId("asset")}.tmp`;
    try {
      await writeFile(temp, input.content, { mode: 0o600, flag: "wx" });
      await rename(temp, path);
      return await this.register(input);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async register(input: RegisterAsset): Promise<Asset> {
    this.assertOwnership(input);
    const path = this.path(input.logicalPath);
    await this.ensureDirectory(dirname(path));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Asset must be a regular file");
    await chmod(path, 0o600);
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk);
      byteLength += (chunk as Buffer).byteLength;
    }
    const digest = input.category === "bash_output" ? null : hash.digest("hex");
    const existing = this.storage.assets
      .list(input.conversationId)
      .find((asset) => asset.logicalPath === input.logicalPath);
    if (existing) {
      if (
        existing.toolCallId !== (input.toolCallId ?? null) ||
        (input.asyncBashId !== undefined &&
          existing.asyncBashId !== input.asyncBashId)
      )
        throw new Error("Asset already belongs to another producer");
      if (existing.eventId !== null || existing.asyncBashId !== null)
        return existing;
      return this.storage.assets.update(existing.id, {
        digest,
        byteLength,
        category: input.category,
        mediaType: input.mediaType ?? null,
      });
    }
    return this.storage.assets.insert({
      id: createId("asset"),
      conversationId: input.conversationId,
      eventId: null,
      toolCallId: input.toolCallId ?? null,
      asyncBashId: input.asyncBashId ?? null,
      category: input.category,
      logicalPath: input.logicalPath,
      digest,
      byteLength,
      mediaType: input.mediaType ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  linkToEvent(assetIds: string[], eventId: string): void {
    for (const id of assetIds) this.storage.assets.update(id, { eventId });
  }

  async readImage(
    assetId: string,
  ): Promise<{ bytes: Buffer; mediaType: string } | null> {
    const asset = this.storage.assets.get(assetId);
    if (
      !asset ||
      asset.category !== "image" ||
      !this.storage.conversations.get(asset.conversationId) ||
      !asset.mediaType ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        asset.mediaType,
      )
    )
      return null;
    return { bytes: await this.read(assetId), mediaType: asset.mediaType };
  }

  async read(assetId: string): Promise<Buffer> {
    const asset = this.storage.assets.get(assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    await this.ensureDirectory(dirname(this.path(asset.logicalPath)));
    const info = await lstat(this.path(asset.logicalPath));
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Asset must be a regular file");
    const bytes = await readFile(this.path(asset.logicalPath));
    if (
      asset.category !== "bash_output" &&
      asset.digest !== null &&
      createHash("sha256").update(bytes).digest("hex") !== asset.digest
    )
      throw new Error("Asset digest mismatch");
    return bytes;
  }

  async deleteConversations(conversationIds: string[]): Promise<void> {
    for (const id of conversationIds) {
      this.assertSegment(id);
      const path = this.path(`conversations/${id}`);
      await this.ensureDirectory(dirname(path));
      await rm(path, { recursive: true, force: true });
      this.storage.transaction(() => {
        for (const asset of this.storage.assets.list(id))
          this.storage.assets.delete(asset.id);
      });
    }
  }

  async cleanupOrphans(): Promise<void> {
    for (const conversation of this.storage.conversations.listAll()) {
      for (const asset of this.storage.assets.list(conversation.id)) {
        if (asset.eventId !== null) continue;
        if (asset.toolCallId && this.storage.toolCalls.get(asset.toolCallId))
          continue;
        if (asset.asyncBashId && this.storage.asyncBash.get(asset.asyncBashId))
          continue;
        await this.ensureDirectory(dirname(this.path(asset.logicalPath)));
        await rm(this.path(asset.logicalPath), { force: true });
        this.storage.assets.delete(asset.id);
      }
    }
  }

  private assertSegment(value: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error("Invalid asset owner ID");
  }

  private assertOwnership(input: RegisterAsset): void {
    this.assertSegment(input.conversationId);
    const owner = input.asyncBashId ?? input.toolCallId;
    if (!owner)
      throw new Error("Asset requires a tool call or async bash owner");
    this.assertSegment(owner);
    const prefix = `conversations/${input.conversationId}/${input.asyncBashId ? "bash" : "tool-calls"}/${owner}/`;
    if (!input.logicalPath.startsWith(prefix))
      throw new Error("Asset path does not match its owner");
    this.path(input.logicalPath);
  }

  private async ensureDirectory(path: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const parts = path.slice(this.dataDir.length).split(sep).filter(Boolean);
    let current = this.dataDir;
    for (const part of ["", ...parts]) {
      if (part) current = resolve(current, part);
      await mkdir(current, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Managed asset directory must not be a symlink");
      await chmod(current, 0o700);
    }
  }
}
