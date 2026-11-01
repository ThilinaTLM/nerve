import type { StatusTone } from "@nervekit/ui-kit/display/status";

import type {
  ConversationEntry,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";

/**
 * Stable icon identifiers. The Svelte layer maps these to `@lucide/svelte`
 * components (see HistoryPoint.svelte). Keeping this module free of component
 * imports lets it stay pure and unit-testable under `node:test`.
 */
export type HistoryIconName =
  | "user"
  | "sparkles"
  | "brain"
  | "wrench"
  | "file-text"
  | "terminal"
  | "file-pen"
  | "file-plus"
  | "search"
  | "folder-search"
  | "folder-tree"
  | "globe"
  | "download"
  | "cpu"
  | "bot"
  | "message-circle-question"
  | "clipboard-list"
  | "clipboard-check"
  | "list-todo"
  | "fold-vertical"
  | "git-branch"
  | "info"
  | "hand"
  | "triangle-alert";

export type HistoryNodeType =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "human_loop"
  | "compaction"
  | "branch_summary"
  | "system";

export type HistoryNodeBadge = {
  icon: HistoryIconName;
  label?: string;
  tone: StatusTone;
  title?: string;
};

export type HistoryNodeDescriptor = {
  type: HistoryNodeType;
  icon: HistoryIconName;
  label: string;
  preview: string;
  tone: StatusTone;
  /** Preview is code/log/path-like content and should render in mono. */
  mono: boolean;
  badges: HistoryNodeBadge[];
};

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:([\s\S]*)\]$/;

/** Tools that always involve a human-in-the-loop interaction. */
const INTERACTION_TOOLS = new Set(["ask_user", "plan_present"]);

const TOOL_ICONS: Record<string, HistoryIconName> = {
  read: "file-text",
  bash: "terminal",
  async_bash: "cpu",
  launch: "cpu",
  python: "terminal",
  edit: "file-pen",
  write: "file-plus",
  grep: "search",
  find: "folder-search",
  ls: "folder-tree",
  web_search: "globe",
  web_fetch: "download",
  ask_user: "message-circle-question",
  plan_present: "clipboard-check",
  todos_set: "list-todo",
  todos_get: "list-todo",
};

export function toolIcon(name: string | undefined): HistoryIconName {
  return (name && TOOL_ICONS[name]) || "wrench";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toolPrefixId(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("tool_")
    ? value
    : undefined;
}

function hasThinking(details: Record<string, unknown> | undefined): boolean {
  const blocks = details?.thinkingBlocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    const record = asRecord(block);
    if (!record) return false;
    return (
      (typeof record.text === "string" && record.text.length > 0) ||
      record.redacted === true
    );
  });
}

/** Resolve the tool record for a tool-result entry, if available. */
function toolIdentity(details: Record<string, unknown> | undefined): {
  recordId?: string;
  providerId?: string;
} {
  if (!details) return {};
  const nested = asRecord(details.details);
  const nestedToolCall = asRecord(nested?.toolCall);
  return {
    recordId:
      toolPrefixId(details.toolRecordId) ?? toolPrefixId(nestedToolCall?.id),
    providerId:
      stringValue(details.toolCallId) ??
      stringValue(details.providerToolCallId) ??
      stringValue(nestedToolCall?.providerToolCallId),
  };
}

function resolveToolRecord(
  details: Record<string, unknown> | undefined,
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
): ToolCallTranscriptRecord | undefined {
  const identity = toolIdentity(details);
  if (identity.recordId) return toolCallsById.get(identity.recordId);
  if (!identity.providerId) return undefined;
  return [...toolCallsById.values()].find(
    (record) =>
      record.providerToolCallId === identity.providerId ||
      record.sourceToolCallId === identity.providerId,
  );
}

/** Parse the tool name(s) out of an assistant "[Tool call: ...]" placeholder. */
export function parseToolCallNames(text: string): string[] {
  const match = text.trim().match(TOOL_CALL_PLACEHOLDER);
  if (!match) return [];
  // Live placeholders list bare names ("[Tool call: bash, edit]"); stored
  // ones may carry arguments ("[Tool call: bash(...)]").
  const withArgs = [...match[1].matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)];
  if (withArgs.length > 0) return withArgs.map((m) => m[1]!);
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name));
}

function trimPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 160)}…` : collapsed;
}

/** Classify a single conversation entry into a compact, icon-driven descriptor. */
export function classifyHistoryEntry(
  entry: ConversationEntry,
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
): HistoryNodeDescriptor {
  const details = asRecord(entry.details);
  const badges: HistoryNodeBadge[] = [];
  const tokens = entry.usage?.totalTokens;
  const tokenBadge = (): HistoryNodeBadge | undefined =>
    tokens && tokens > 0
      ? {
          icon: "sparkles",
          label: tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`,
          tone: "neutral",
          title: `${tokens.toLocaleString()} tokens`,
        }
      : undefined;

  // Non-message kinds first.
  if (entry.kind === "compaction") {
    return {
      type: "compaction",
      icon: "fold-vertical",
      label: "Compacted",
      preview: trimPreview(entry.summary || entry.text),
      tone: "info",
      mono: false,
      badges,
    };
  }
  if (entry.kind === "branch_summary") {
    return {
      type: "branch_summary",
      icon: "git-branch",
      label: "Branch summary",
      preview: trimPreview(entry.summary || entry.text),
      tone: "info",
      mono: false,
      badges,
    };
  }
  if (entry.role === "user") {
    return {
      type: "user",
      icon: "user",
      label: "You",
      preview: trimPreview(entry.text) || "empty message",
      tone: "neutral",
      mono: false,
      badges,
    };
  }

  if (entry.role === "assistant") {
    if (hasThinking(details)) {
      badges.push({ icon: "brain", tone: "info", title: "Includes thinking" });
    }
    const names = parseToolCallNames(entry.text);
    if (names.length > 0) {
      const primary = names[0];
      const isInteraction = names.some((name) => INTERACTION_TOOLS.has(name));
      const extra = names.length > 1 ? ` +${names.length - 1}` : "";
      return {
        type: isInteraction ? "human_loop" : "tool_call",
        icon: toolIcon(primary),
        label: `${primary}${extra}`,
        preview: names.slice(0, 4).join(", "),
        tone: isInteraction ? "warning" : "neutral",
        mono: true,
        badges: isInteraction
          ? [{ icon: "hand", label: "input", tone: "warning" }, ...badges]
          : badges,
      };
    }
    const token = tokenBadge();
    if (token) badges.push(token);
    return {
      type: "assistant",
      icon: "sparkles",
      label: "Assistant",
      preview: trimPreview(entry.text) || "(thinking)",
      tone: "neutral",
      mono: false,
      badges,
    };
  }

  // role === "system": tool results and system notices.
  const toolName = stringValue(details?.toolName);
  if (toolName) {
    const record = resolveToolRecord(details, toolCallsById);
    const isError =
      details?.isError === true ||
      record?.status === "failed" ||
      record?.status === "denied";
    const humanLoop =
      INTERACTION_TOOLS.has(toolName) ||
      record?.risk === "interaction" ||
      record?.interaction?.kind === "approval";
    if (humanLoop) {
      badges.push({ icon: "hand", label: "human", tone: "warning" });
    }
    if (isError) {
      badges.push({
        icon: "triangle-alert",
        label: "error",
        tone: "destructive",
      });
    }
    return {
      type: humanLoop ? "human_loop" : "tool_result",
      icon: toolIcon(toolName),
      label: toolName,
      preview: trimPreview(entry.text),
      tone: isError ? "destructive" : humanLoop ? "warning" : "success",
      mono: true,
      badges,
    };
  }

  return {
    type: "system",
    icon: "info",
    label: "System",
    preview: trimPreview(entry.text) || "system entry",
    tone: "neutral",
    mono: false,
    badges,
  };
}
