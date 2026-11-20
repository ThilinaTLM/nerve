import type { AgentMessage } from "../messages/messages.js";

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export function createFileOps(): FileOperations {
  return { read: new Set(), written: new Set(), edited: new Set() };
}

export function extractFileOpsFromMessage(
  message: AgentMessage,
  fileOps: FileOperations,
): void {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (
      typeof block !== "object" ||
      block === null ||
      !("type" in block) ||
      block.type !== "toolCall"
    )
      continue;
    if (!("arguments" in block) || !("name" in block)) continue;
    const args = block.arguments as Record<string, unknown> | undefined;
    const path = typeof args?.path === "string" ? args.path : undefined;
    if (!path) continue;
    if (block.name === "read") fileOps.read.add(path);
    else if (block.name === "write") fileOps.written.add(path);
    else if (block.name === "edit") fileOps.edited.add(path);
  }
}

export function computeFileLists(fileOps: FileOperations): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  return {
    readFiles: [...fileOps.read].filter((file) => !modified.has(file)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}
