import { ConversationError } from "../errors.js";
import { toError } from "../result.js";
import type {
  ConversationTreeEntry,
  JsonlConversationMetadata,
} from "./entries.js";

export interface ConversationHeader {
  type: "conversation";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  parentConversation?: string;
}

export function serializeJsonlHeader(header: ConversationHeader): string {
  return `${JSON.stringify(header)}\n`;
}

export function serializeJsonlEntry(entry: ConversationTreeEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function invalidConversation(
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

export function invalidEntry(
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

export function parseHeaderLine(
  line: string,
  filePath: string,
): ConversationHeader {
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

export function parseEntryLine(
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
  const requireString = (field: string, optional = false): void => {
    const value = parsed[field];
    if (optional && value === undefined) return;
    if (typeof value !== "string") {
      throw invalidEntry(filePath, lineNumber, `has invalid ${field}`);
    }
  };
  const requireBoolean = (field: string, optional = false): void => {
    const value = parsed[field];
    if (optional && value === undefined) return;
    if (typeof value !== "boolean") {
      throw invalidEntry(filePath, lineNumber, `has invalid ${field}`);
    }
  };
  const requireNumber = (field: string): void => {
    if (typeof parsed[field] !== "number" || !Number.isFinite(parsed[field])) {
      throw invalidEntry(filePath, lineNumber, `has invalid ${field}`);
    }
  };

  switch (parsed.type) {
    case "message":
      if (
        !isRecord(parsed.message) ||
        typeof parsed.message.role !== "string"
      ) {
        throw invalidEntry(filePath, lineNumber, "has invalid message");
      }
      break;
    case "thinking_level_change":
      requireString("thinkingLevel");
      break;
    case "model_change":
      requireString("provider");
      requireString("modelId");
      break;
    case "active_tools_change":
      if (
        !Array.isArray(parsed.activeToolNames) ||
        !parsed.activeToolNames.every((name) => typeof name === "string")
      ) {
        throw invalidEntry(filePath, lineNumber, "has invalid activeToolNames");
      }
      break;
    case "compaction":
      requireString("summary");
      requireString("firstKeptEntryId");
      requireNumber("tokensBefore");
      requireBoolean("fromHook", true);
      break;
    case "branch_summary":
      requireString("fromId");
      requireString("summary");
      requireBoolean("fromHook", true);
      break;
    case "custom":
      requireString("customType");
      break;
    case "custom_message":
      requireString("customType");
      if (
        typeof parsed.content !== "string" &&
        !Array.isArray(parsed.content)
      ) {
        throw invalidEntry(filePath, lineNumber, "has invalid content");
      }
      requireBoolean("display");
      break;
    case "label":
      requireString("targetId");
      requireString("label", true);
      break;
    case "conversation_info":
      requireString("name", true);
      break;
    case "leaf":
      if (parsed.targetId !== null && typeof parsed.targetId !== "string") {
        throw invalidEntry(filePath, lineNumber, "has invalid targetId");
      }
      break;
    default:
      throw invalidEntry(
        filePath,
        lineNumber,
        `has unsupported entry type '${parsed.type}'`,
      );
  }
  return parsed as unknown as ConversationTreeEntry;
}

export function headerToConversationMetadata(
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
