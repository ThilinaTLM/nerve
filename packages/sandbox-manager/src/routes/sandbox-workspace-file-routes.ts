import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  posix as posixPath,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline";
import {
  type SandboxWorkspaceFileQuery,
  type SandboxWorkspaceFileResponse,
  sandboxWorkspaceFileQuerySchema,
  sandboxWorkspaceFileResponseSchema,
} from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { HttpError } from "../http/errors.js";

const maxTextBytes = 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const lineWindowBefore = 200;
const lineWindowAfter = 800;

const imageMimeByExtension = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"],
  [".avif", "image/avif"],
]);

const textExtensions = new Set([
  ".bash",
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

type ResolvedWorkspacePath = {
  hostPath: string;
  sandboxPath: string;
  relativePath: string;
};

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeSandboxTarget(target: string | undefined): string {
  const trimmed = target?.trim() || "/workspace";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = posixPath.normalize(withSlash);
  return normalized === "/" ? "/workspace" : normalized.replace(/\/+$/, "");
}

function normalizeIncomingSandboxPath(rawPath: string): string {
  let value = rawPath.trim();
  if (value.toLowerCase().startsWith("file://")) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname);
    } catch {
      // Keep malformed file URLs on the normal validation path.
    }
  }
  return value.replaceAll("\\", "/");
}

function visiblePath(target: string, relativePath: string): string {
  return relativePath ? posixPath.join(target, relativePath) : target;
}

function relativePathFromAbsolute(
  normalizedPath: string,
  targets: string[],
): { target: string; relativePath: string } | undefined {
  for (const target of targets) {
    if (normalizedPath === target) return { target, relativePath: "" };
    const prefix = `${target}/`;
    if (normalizedPath.startsWith(prefix)) {
      return {
        target,
        relativePath: normalizedPath.slice(prefix.length),
      };
    }
  }
  return undefined;
}

function rejectEscapingPath(): never {
  throw new HttpError(
    403,
    "Workspace file previews are limited to the sandbox workspace",
    "FORBIDDEN",
  );
}

async function resolveWorkspaceFilePath(
  workspaceSource: string,
  workspaceTarget: string,
  rawPath: string,
): Promise<ResolvedWorkspacePath> {
  const sourceRoot = resolve(workspaceSource);
  const requestPath = normalizeIncomingSandboxPath(rawPath);
  const targets = Array.from(new Set([workspaceTarget, "/workspace"]));

  let selectedTarget = workspaceTarget;
  let sandboxRelative: string;
  if (posixPath.isAbsolute(requestPath)) {
    const normalized = posixPath.normalize(requestPath);
    const match = relativePathFromAbsolute(normalized, targets);
    if (!match) rejectEscapingPath();
    selectedTarget = match.target;
    sandboxRelative = match.relativePath;
  } else {
    sandboxRelative = posixPath.normalize(requestPath);
  }

  if (sandboxRelative === ".") sandboxRelative = "";
  if (
    sandboxRelative === ".." ||
    sandboxRelative.startsWith("../") ||
    posixPath.isAbsolute(sandboxRelative)
  ) {
    rejectEscapingPath();
  }

  const hostPath = resolve(sourceRoot, sandboxRelative);
  if (!isInside(sourceRoot, hostPath)) rejectEscapingPath();

  // Follow symlinks before reading so a link inside the workspace cannot expose
  // arbitrary host files. Missing files are reported using the sandbox path.
  let realRoot: string;
  let realTarget: string;
  try {
    [realRoot, realTarget] = await Promise.all([
      realpath(sourceRoot),
      realpath(hostPath),
    ]);
  } catch {
    throw new HttpError(
      404,
      `Workspace file not found: ${visiblePath(selectedTarget, sandboxRelative)}`,
      "NOT_FOUND",
    );
  }
  if (!isInside(realRoot, realTarget)) rejectEscapingPath();

  return {
    hostPath: realTarget,
    sandboxPath: visiblePath(selectedTarget, sandboxRelative),
    relativePath: sandboxRelative.replaceAll("\\", "/"),
  };
}

async function readFileChunk(path: string, bytes: number): Promise<Buffer> {
  if (bytes <= 0) return Buffer.alloc(0);
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function unreadableFileError(sandboxPath: string): HttpError {
  return new HttpError(
    403,
    `Workspace file could not be read: ${sandboxPath}`,
    "FORBIDDEN",
  );
}

async function readPreviewChunk(
  hostPath: string,
  sandboxPath: string,
  bytes: number,
): Promise<Buffer> {
  try {
    return await readFileChunk(hostPath, bytes);
  } catch {
    throw unreadableFileError(sandboxPath);
  }
}

async function readPreviewLineWindow(
  hostPath: string,
  sandboxPath: string,
  targetLine: number,
): Promise<{ text: string; lineStart: number }> {
  try {
    return await readTextLineWindow(hostPath, targetLine);
  } catch {
    throw unreadableFileError(sandboxPath);
  }
}

function looksTextual(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  return buffer.toString("utf8").includes("�") === false;
}

async function readTextLineWindow(
  path: string,
  targetLine: number,
): Promise<{ text: string; lineStart: number }> {
  const startLine = Math.max(1, targetLine - lineWindowBefore);
  const endLine = targetLine + lineWindowAfter;
  const lines: string[] = [];
  let lineStart = startLine;
  let bytes = 0;
  let lineNumber = 0;

  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    lineNumber += 1;
    if (lineNumber < startLine) continue;
    if (lineNumber > endLine) break;

    const lineBytes = Buffer.byteLength(line) + 1;
    if (lines.length > 0 && bytes + lineBytes > maxTextBytes) break;

    if (lines.length === 0) lineStart = lineNumber;
    lines.push(line);
    bytes += lineBytes;
  }

  return { text: lines.join("\n"), lineStart };
}

export async function getSandboxWorkspaceFile(
  state: ManagerState,
  sandboxId: string,
  input: unknown,
): Promise<SandboxWorkspaceFileResponse> {
  const query: SandboxWorkspaceFileQuery =
    sandboxWorkspaceFileQuerySchema.parse(input);
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  if (!record.workspaceRef.source) {
    throw new HttpError(
      409,
      "Workspace file preview is unavailable for this volume backend",
      "INVALID_STATE",
    );
  }

  const workspaceTarget = normalizeSandboxTarget(record.workspaceRef.target);
  const resolved = await resolveWorkspaceFilePath(
    record.workspaceRef.source,
    workspaceTarget,
    query.path,
  );

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(resolved.hostPath);
  } catch {
    throw new HttpError(
      404,
      `Workspace file not found: ${resolved.sandboxPath}`,
      "NOT_FOUND",
    );
  }
  if (info.isDirectory()) {
    throw new HttpError(
      400,
      `Workspace path is a directory: ${resolved.sandboxPath}`,
      "VALIDATION_FAILED",
    );
  }

  const ext = extname(resolved.hostPath).toLowerCase();
  const imageMimeType = imageMimeByExtension.get(ext);
  const base = {
    sandboxId: record.sandboxId,
    path: resolved.sandboxPath,
    relativePath: resolved.relativePath,
    name: basename(resolved.sandboxPath),
    size: info.size,
    mtimeMs: info.mtimeMs,
  };

  if (imageMimeType) {
    if (info.size > maxImageBytes) {
      return sandboxWorkspaceFileResponseSchema.parse({
        ...base,
        type: "binary",
        binary: true,
        mimeType: imageMimeType,
        truncated: true,
      });
    }
    const chunk = await readPreviewChunk(
      resolved.hostPath,
      resolved.sandboxPath,
      info.size,
    );
    return sandboxWorkspaceFileResponseSchema.parse({
      ...base,
      type: "image",
      binary: false,
      dataBase64: chunk.toString("base64"),
      mimeType: imageMimeType,
      truncated: false,
    });
  }

  const readBytes = Math.min(info.size, maxTextBytes + 1);
  const chunk = await readPreviewChunk(
    resolved.hostPath,
    resolved.sandboxPath,
    readBytes,
  );
  const truncated = info.size > maxTextBytes;
  const textChunk = truncated ? chunk.subarray(0, maxTextBytes) : chunk;
  const textual = textExtensions.has(ext) || looksTextual(textChunk);
  const lineWindow =
    textual && truncated && query.line
      ? await readPreviewLineWindow(
          resolved.hostPath,
          resolved.sandboxPath,
          query.line,
        )
      : undefined;

  return sandboxWorkspaceFileResponseSchema.parse({
    ...base,
    type: textual ? "text" : "binary",
    binary: !textual,
    text: textual
      ? (lineWindow?.text ?? textChunk.toString("utf8"))
      : undefined,
    lineStart: textual ? (lineWindow?.lineStart ?? 1) : undefined,
    targetLine: textual ? query.line : undefined,
    truncated,
  });
}
