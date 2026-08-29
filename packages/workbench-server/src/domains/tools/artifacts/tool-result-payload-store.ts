import type {
  ToolResultPayloadReference,
  ValidatedToolArtifact,
} from "@nervekit/contracts";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { atomicWriteFile } from "../../../infrastructure/storage-bootstrap/file-mutations.js";
import { storagePaths } from "../../../infrastructure/storage-bootstrap/paths.js";

const PAYLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

export class ToolResultPayloadUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ToolResultPayloadUnavailableError";
  }
}

export class ToolResultPayloadCorruptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ToolResultPayloadCorruptError";
  }
}

export class ToolResultPayloadStore {
  readonly root: string;
  private readonly verified = new Map<
    string,
    { byteLength: number; mtimeMs: number }
  >();

  constructor(readonly home: string) {
    this.root = storagePaths(home).payloadsPath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ToolResultPayloadCorruptError(
        `Payload root '${this.root}' is not a regular directory.`,
      );
    }
    await chmod(this.root, 0o700).catch(() => undefined);
  }

  async write(
    conversationId: string,
    toolCallId: string,
    result: unknown,
    completeness: ToolResultPayloadReference["completeness"] = "complete",
  ): Promise<ToolResultPayloadReference> {
    assertOwnerId(conversationId, "conv_");
    assertOwnerId(toolCallId, "tool_");
    const serialized = serializeToolResult(result);
    const bytes = Buffer.from(serialized, "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const reference: ToolResultPayloadReference = {
      version: 1,
      kind: "tool_result",
      conversationId,
      toolCallId,
      logicalPath: `payloads/conversations/${conversationId}/tool-calls/${toolCallId}/result.json`,
      digest,
      byteLength: bytes.byteLength,
      mediaType: "application/json",
      encoding: "utf-8",
      completeness,
    };
    const path = this.path(reference);
    await this.ensurePrivateDirectory(conversationId, toolCallId);
    await atomicWriteFile(path, bytes, { mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
    await this.verify(reference);
    return reference;
  }

  path(reference: ToolResultPayloadReference): string {
    assertOwnerId(reference.conversationId, "conv_");
    assertOwnerId(reference.toolCallId, "tool_");
    if (!/^[a-f0-9]{64}$/.test(reference.digest)) {
      throw new ToolResultPayloadCorruptError(
        "Invalid tool-result payload digest.",
      );
    }
    const candidate = join(
      this.root,
      "conversations",
      reference.conversationId,
      "tool-calls",
      reference.toolCallId,
      "result.json",
    );
    assertWithin(this.root, candidate);
    return candidate;
  }

  recoveryArtifact(
    reference: ToolResultPayloadReference,
  ): ValidatedToolArtifact {
    return {
      version: 1,
      id: "complete_payload",
      role: "overflow_recovery",
      access: { kind: "agent_file", path: this.path(reference) },
      availability: "available",
      format: {
        kind: "json",
        mediaType: reference.mediaType,
        encoding: "utf-8",
      },
      size: { bytes: reference.byteLength },
      recommendedTools: ["read", "grep"],
      label: "Complete tool result payload",
    };
  }

  filesPath(conversationId: string, toolCallId: string): string {
    assertOwnerId(conversationId, "conv_");
    assertOwnerId(toolCallId, "tool_");
    const candidate = join(
      this.root,
      "conversations",
      conversationId,
      "tool-calls",
      toolCallId,
      "files",
    );
    assertWithin(this.root, candidate);
    return candidate;
  }

  async read(reference: ToolResultPayloadReference): Promise<unknown> {
    const bytes = await this.readVerifiedBytes(reference);
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (cause) {
      throw new ToolResultPayloadCorruptError(
        `Tool-result payload '${reference.toolCallId}' is not valid JSON.`,
        { cause },
      );
    }
  }

  async verify(reference: ToolResultPayloadReference): Promise<void> {
    await this.verifyStreaming(reference);
  }

  async readTextRange(
    reference: ToolResultPayloadReference,
    byteOffset: number,
    byteLimit: number,
  ): Promise<{
    text: string;
    byteOffset: number;
    nextByteOffset: number;
    totalBytes: number;
  }> {
    await this.verifyStreaming(reference);
    const totalBytes = reference.byteLength;
    if (byteOffset >= totalBytes) {
      return {
        text: "",
        byteOffset: totalBytes,
        nextByteOffset: totalBytes,
        totalBytes,
      };
    }
    const handle = await open(this.path(reference), "r");
    try {
      const requested = Math.min(byteLimit + 6, totalBytes - byteOffset);
      const buffer = Buffer.allocUnsafe(requested);
      const { bytesRead } = await handle.read(buffer, 0, requested, byteOffset);
      const bounded = utf8TextRange(buffer.subarray(0, bytesRead), byteLimit);
      return {
        text: bounded.text,
        byteOffset: byteOffset + bounded.start,
        nextByteOffset: byteOffset + bounded.end,
        totalBytes,
      };
    } finally {
      await handle.close();
    }
  }

  async removeConversation(conversationId: string): Promise<void> {
    assertOwnerId(conversationId, "conv_");
    await rm(join(this.root, "conversations", conversationId), {
      recursive: true,
      force: true,
    });
  }

  async reconcile(
    referenced: ReadonlySet<string>,
    now = Date.now(),
  ): Promise<{ removed: number; skipped: number }> {
    const conversationsRoot = join(this.root, "conversations");
    const conversations = await readdir(conversationsRoot, {
      withFileTypes: true,
    }).catch(() => []);
    let removed = 0;
    let skipped = 0;
    for (const conversation of conversations) {
      if (!conversation.isDirectory() || conversation.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      const callsRoot = join(
        conversationsRoot,
        conversation.name,
        "tool-calls",
      );
      const calls = await readdir(callsRoot, { withFileTypes: true }).catch(
        () => [],
      );
      for (const call of calls) {
        if (!call.isDirectory() || call.isSymbolicLink()) {
          skipped += 1;
          continue;
        }
        const callPath = join(callsRoot, call.name);
        const resultPath = join(callPath, "result.json");
        if (referenced.has(resolve(resultPath))) continue;
        const info = await lstat(resultPath).catch(() => undefined);
        if (!info || now - info.mtimeMs < PAYLOAD_GRACE_MS) {
          skipped += 1;
          continue;
        }
        await rm(callPath, { recursive: true, force: true });
        removed += 1;
      }
    }
    return { removed, skipped };
  }

  private async ensurePrivateDirectory(
    conversationId: string,
    toolCallId: string,
  ): Promise<void> {
    const directories = [
      this.root,
      join(this.root, "conversations"),
      join(this.root, "conversations", conversationId),
      join(this.root, "conversations", conversationId, "tool-calls"),
      join(
        this.root,
        "conversations",
        conversationId,
        "tool-calls",
        toolCallId,
      ),
    ];
    for (const directory of directories) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new ToolResultPayloadCorruptError(
          `Payload directory '${directory}' is not a regular directory.`,
        );
      }
      await chmod(directory, 0o700).catch(() => undefined);
    }
  }

  private async assertDirectoryChain(
    conversationId: string,
    toolCallId: string,
  ): Promise<void> {
    const directories = [
      this.root,
      join(this.root, "conversations"),
      join(this.root, "conversations", conversationId),
      join(this.root, "conversations", conversationId, "tool-calls"),
      join(
        this.root,
        "conversations",
        conversationId,
        "tool-calls",
        toolCallId,
      ),
    ];
    for (const directory of directories) {
      let info;
      try {
        info = await lstat(directory);
      } catch (cause) {
        throw new ToolResultPayloadUnavailableError(
          `Payload directory '${directory}' is unavailable.`,
          { cause },
        );
      }
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new ToolResultPayloadCorruptError(
          `Payload directory '${directory}' is not a regular directory.`,
        );
      }
    }
  }

  private async payloadInfo(reference: ToolResultPayloadReference) {
    const path = this.path(reference);
    await this.assertDirectoryChain(
      reference.conversationId,
      reference.toolCallId,
    );
    let info;
    try {
      info = await lstat(path);
    } catch (cause) {
      throw new ToolResultPayloadUnavailableError(
        `Tool-result payload '${reference.toolCallId}' is unavailable.`,
        { cause },
      );
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new ToolResultPayloadCorruptError(
        `Tool-result payload '${reference.toolCallId}' is not a regular file.`,
      );
    }
    return { path, info };
  }

  private async verifyStreaming(
    reference: ToolResultPayloadReference,
  ): Promise<void> {
    const { path, info } = await this.payloadInfo(reference);
    const cached = this.verified.get(reference.digest);
    if (
      cached?.byteLength === info.size &&
      cached.mtimeMs === info.mtimeMs &&
      info.size === reference.byteLength
    ) {
      return;
    }
    const hash = createHash("sha256");
    let byteLength = 0;
    try {
      for await (const chunk of createReadStream(path)) {
        const bytes = chunk as Buffer;
        byteLength += bytes.byteLength;
        hash.update(bytes);
      }
    } catch (cause) {
      throw new ToolResultPayloadUnavailableError(
        `Tool-result payload '${reference.toolCallId}' is unavailable.`,
        { cause },
      );
    }
    if (
      byteLength !== reference.byteLength ||
      hash.digest("hex") !== reference.digest
    ) {
      throw new ToolResultPayloadCorruptError(
        `Tool-result payload '${reference.toolCallId}' failed verification.`,
      );
    }
    this.verified.set(reference.digest, {
      byteLength: info.size,
      mtimeMs: info.mtimeMs,
    });
  }

  private async readVerifiedBytes(
    reference: ToolResultPayloadReference,
  ): Promise<Buffer> {
    await this.verifyStreaming(reference);
    return await readFile(this.path(reference));
  }
}

export function utf8TextRange(
  bytes: Buffer,
  byteLimit: number,
): { text: string; start: number; end: number } {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let start = 0; start <= Math.min(3, bytes.byteLength); start += 1) {
    const maximumEnd = Math.min(bytes.byteLength, start + byteLimit);
    for (
      let end = maximumEnd;
      end >= Math.max(start, maximumEnd - 3);
      end -= 1
    ) {
      try {
        return { text: decoder.decode(bytes.subarray(start, end)), start, end };
      } catch {
        // Try the adjacent UTF-8 boundary.
      }
    }
  }
  throw new ToolResultPayloadCorruptError(
    "Tool-result payload range is not valid UTF-8.",
  );
}

export function serializeToolResult(result: unknown): string {
  const seen = new WeakSet<object>();
  return `${JSON.stringify(
    result,
    (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (!value || typeof value !== "object") return value;
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      if (Array.isArray(value)) return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      );
    },
    2,
  )}\n`;
}

function assertOwnerId(value: string, prefix: "conv_" | "tool_"): void {
  if (!value.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ToolResultPayloadCorruptError(
      `Invalid payload owner id '${value}'.`,
    );
  }
}

function assertWithin(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new ToolResultPayloadCorruptError(
      "Payload path escapes its storage root.",
    );
  }
}
