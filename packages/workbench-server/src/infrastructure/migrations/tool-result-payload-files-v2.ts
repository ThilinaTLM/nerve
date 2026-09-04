import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StoragePaths } from "../storage-bootstrap/paths.js";

export async function preflightLegacyPayloadFiles(
  paths: StoragePaths,
): Promise<void> {
  await copyLegacyPayloadFiles(paths, true);
}

export async function copyLegacyPayloadFiles(
  paths: StoragePaths,
  validateOnly = false,
): Promise<void> {
  const legacyConversations = join(paths.dataPath, "payloads", "conversations");
  const legacyKind = await pathKind(legacyConversations);
  if (legacyKind === "invalid") {
    throw new Error(
      `Legacy conversation payload root '${legacyConversations}' is not a directory.`,
    );
  }
  if (legacyKind === "directory") {
    await copyNormalizedConversationTree(
      legacyConversations,
      paths.conversationsPath,
      validateOnly,
    );
  }
  await copyNormalizedConversationTree(
    paths.conversationsPath,
    paths.conversationsPath,
    validateOnly,
  );
}

async function copyNormalizedConversationTree(
  sourceRoot: string,
  targetRoot: string,
  validateOnly: boolean,
): Promise<void> {
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(
        `Invalid conversation storage entry '${join(sourceRoot, entry.name)}'.`,
      );
    }
    const conversationSegment = compactOwnerSegment(
      entry.name,
      "conv_",
      "conversation",
      sourceRoot,
    );
    const sourceConversation = join(sourceRoot, entry.name);
    const targetConversation = join(targetRoot, conversationSegment);
    await copyDirectory(sourceConversation, targetConversation, validateOnly);

    const sourceToolCalls = join(sourceConversation, "tool-calls");
    const toolCallsKind = await pathKind(sourceToolCalls);
    if (toolCallsKind === "missing") continue;
    if (toolCallsKind !== "directory") {
      throw new Error(`Invalid tool-call storage path '${sourceToolCalls}'.`);
    }
    for (const call of await readdir(sourceToolCalls, {
      withFileTypes: true,
    })) {
      if (!call.isDirectory() || call.isSymbolicLink()) {
        throw new Error(
          `Invalid tool-call storage entry '${join(sourceToolCalls, call.name)}'.`,
        );
      }
      const callSegment = compactOwnerSegment(
        call.name,
        "tool_",
        "tool call",
        sourceToolCalls,
      );
      await copyDirectory(
        join(sourceToolCalls, call.name),
        join(targetConversation, "tool-calls", callSegment),
        validateOnly,
      );
    }
  }
}

function compactOwnerSegment(
  name: string,
  prefix: "conv_" | "tool_",
  label: string,
  root: string,
): string {
  const compact = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  if (!compact || !/^[A-Za-z0-9_-]+$/.test(compact)) {
    throw new Error(
      `Invalid ${label} storage directory '${join(root, name)}'.`,
    );
  }
  return compact;
}

async function copyDirectory(
  source: string,
  target: string,
  validateOnly: boolean,
): Promise<void> {
  if (source === target) {
    await validateDirectoryEntries(source);
    return;
  }
  const sourceKind = await pathKind(source);
  if (sourceKind !== "directory") {
    throw new Error(`Managed migration source '${source}' is not a directory.`);
  }
  const targetKind = await pathKind(target);
  if (targetKind === "invalid") {
    throw new Error(`Managed migration target '${target}' is not a directory.`);
  }
  if (targetKind === "missing" && !validateOnly) {
    await mkdir(target, { recursive: true, mode: 0o700 });
  }
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const targetEntry = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Managed migration rejects symlink '${sourceEntry}'.`);
    }
    if (entry.isDirectory()) {
      await copyDirectory(sourceEntry, targetEntry, validateOnly);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Managed migration rejects special file '${sourceEntry}'.`,
      );
    }
    const targetInfo = await lstat(targetEntry).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (targetInfo) {
      if (
        targetInfo.isSymbolicLink() ||
        !targetInfo.isFile() ||
        !(await filesEqual(sourceEntry, targetEntry))
      ) {
        throw new Error(`Managed migration file conflict at '${targetEntry}'.`);
      }
    } else if (!validateOnly) {
      await mkdir(dirname(targetEntry), { recursive: true, mode: 0o700 });
      await copyFile(sourceEntry, targetEntry);
    }
  }
}

async function validateDirectoryEntries(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Managed migration rejects symlink '${entryPath}'.`);
    }
    if (entry.isDirectory()) await validateDirectoryEntries(entryPath);
    else if (!entry.isFile()) {
      throw new Error(`Managed migration rejects special file '${entryPath}'.`);
    }
  }
}

export async function migrateLegacyPayloadFiles(
  paths: StoragePaths,
): Promise<void> {
  const legacyPayloads = join(paths.dataPath, "payloads");
  const legacyConversations = join(legacyPayloads, "conversations");
  if ((await pathKind(legacyConversations)) === "directory") {
    await normalizeConversationTree(legacyConversations);
    await mergeDirectory(legacyConversations, paths.conversationsPath);
    await removeIfEmpty(legacyConversations);
  } else if ((await pathKind(legacyConversations)) === "invalid") {
    throw new Error(
      `Legacy conversation payload root '${legacyConversations}' is not a directory.`,
    );
  }
  await normalizeConversationTree(paths.conversationsPath);
  await removeIfEmpty(legacyPayloads);
}

async function normalizeConversationTree(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const conversations = await readdir(root, { withFileTypes: true });
  for (const entry of conversations) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(
        `Invalid conversation storage entry '${join(root, entry.name)}'.`,
      );
    }
    const conversationPath = await normalizeOwnerDirectory(
      root,
      entry.name,
      "conv_",
      "conversation",
    );
    const toolCallsPath = join(conversationPath, "tool-calls");
    const toolCallsKind = await pathKind(toolCallsPath);
    if (toolCallsKind === "missing") continue;
    if (toolCallsKind !== "directory") {
      throw new Error(`Invalid tool-call storage path '${toolCallsPath}'.`);
    }
    const calls = await readdir(toolCallsPath, { withFileTypes: true });
    for (const call of calls) {
      if (!call.isDirectory() || call.isSymbolicLink()) {
        throw new Error(
          `Invalid tool-call storage entry '${join(toolCallsPath, call.name)}'.`,
        );
      }
      await normalizeOwnerDirectory(
        toolCallsPath,
        call.name,
        "tool_",
        "tool call",
      );
    }
  }
}

async function normalizeOwnerDirectory(
  root: string,
  name: string,
  prefix: "conv_" | "tool_",
  label: string,
): Promise<string> {
  const compact = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  if (!compact || !/^[A-Za-z0-9_-]+$/.test(compact)) {
    throw new Error(
      `Invalid ${label} storage directory '${join(root, name)}'.`,
    );
  }
  const source = join(root, name);
  const target = join(root, compact);
  if (source === target) return target;
  await mergeDirectory(source, target);
  await removeIfEmpty(source);
  return target;
}

async function mergeDirectory(source: string, target: string): Promise<void> {
  const sourceKind = await pathKind(source);
  if (sourceKind === "missing") return;
  if (sourceKind !== "directory") {
    throw new Error(`Managed migration source '${source}' is not a directory.`);
  }
  const targetKind = await pathKind(target);
  if (targetKind === "missing") {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rename(source, target);
    return;
  }
  if (targetKind !== "directory") {
    throw new Error(`Managed migration target '${target}' is not a directory.`);
  }
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Managed migration rejects symlink '${join(source, entry.name)}'.`,
      );
    }
    const sourceEntry = join(source, entry.name);
    const targetEntry = join(target, entry.name);
    const existing = await pathKind(targetEntry);
    if (entry.isDirectory()) {
      if (existing === "invalid") {
        throw new Error(`Managed migration path conflict at '${targetEntry}'.`);
      }
      await mergeDirectory(sourceEntry, targetEntry);
      await removeIfEmpty(sourceEntry);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Managed migration rejects special file '${sourceEntry}'.`,
      );
    }
    if (existing === "missing") {
      await rename(sourceEntry, targetEntry);
      continue;
    }
    const targetInfo = await lstat(targetEntry);
    if (
      targetInfo.isSymbolicLink() ||
      !targetInfo.isFile() ||
      !(await filesEqual(sourceEntry, targetEntry))
    ) {
      throw new Error(`Managed migration file conflict at '${targetEntry}'.`);
    }
    await rm(sourceEntry, { force: true });
  }
  await removeIfEmpty(source);
}

async function filesEqual(left: string, right: string): Promise<boolean> {
  const [leftInfo, rightInfo] = await Promise.all([stat(left), stat(right)]);
  if (!leftInfo.isFile() || !rightInfo.isFile()) return false;
  if (leftInfo.size !== rightInfo.size) return false;
  const [leftDigest, rightDigest] = await Promise.all([
    fileDigest(left),
    fileDigest(right),
  ]);
  return leftDigest === rightDigest;
}

function fileDigest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function removeIfEmpty(path: string): Promise<void> {
  if ((await pathKind(path)) !== "directory") return;
  if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
}

async function pathKind(
  path: string,
): Promise<"missing" | "directory" | "invalid"> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return "missing";
  return info.isDirectory() && !info.isSymbolicLink() ? "directory" : "invalid";
}
