import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";

/**
 * Stable icon identifiers. The Svelte layer maps these to `@lucide/svelte`
 * components (see HistoryGraphNode.svelte). Keeping this module free of component
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

export type HistoryTone = "default" | "success" | "warning" | "info" | "danger";

export type HistoryNodeType =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "human_loop"
  | "compaction"
  | "branch_summary"
  | "explore_report"
  | "system";

export type HistoryNodeBadge = {
  icon: HistoryIconName;
  label?: string;
  tone: HistoryTone;
  title?: string;
};

export type HistoryNodeDescriptor = {
  type: HistoryNodeType;
  icon: HistoryIconName;
  label: string;
  preview: string;
  tone: HistoryTone;
  /** Preview is code/log/path-like content and should render in mono. */
  mono: boolean;
  badges: HistoryNodeBadge[];
};

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:([\s\S]*)\]$/;

/** Tools that always involve a human-in-the-loop interaction. */
const INTERACTION_TOOLS = new Set(["ask_user", "plan_mode_present"]);

const TOOL_ICONS: Record<string, HistoryIconName> = {
  read: "file-text",
  bash: "terminal",
  python: "terminal",
  edit: "file-pen",
  write: "file-plus",
  grep: "search",
  find: "folder-search",
  ls: "folder-tree",
  web_search: "globe",
  web_fetch: "download",
  task_start: "cpu",
  task_status: "cpu",
  task_logs: "cpu",
  task_cancel: "cpu",
  task_restart: "cpu",
  task_list: "cpu",
  explore: "search",
  ask_user: "message-circle-question",
  plan_mode_enter: "clipboard-list",
  plan_mode_present: "clipboard-check",
  plan_mode_force_exit: "clipboard-list",
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
function resolveToolRecord(
  details: Record<string, unknown> | undefined,
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
): ToolCallTranscriptRecord | undefined {
  if (!details) return undefined;
  const nested = asRecord(details.details);
  const nestedToolCall = asRecord(nested?.toolCall);
  const recordId =
    toolPrefixId(details.toolRecordId) ?? toolPrefixId(nestedToolCall?.id);
  return recordId ? toolCallsById.get(recordId) : undefined;
}

/** Resolve the {@link ToolCallTranscriptRecord} backing a conversation entry, if any. */
export function resolveToolCallForEntry(
  entry: ConversationEntry,
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
): ToolCallTranscriptRecord | undefined {
  return resolveToolRecord(asRecord(entry.details), toolCallsById);
}

/** Parse the tool name(s) out of an assistant "[Tool call: name(...)]" placeholder. */
export function parseToolCallNames(text: string): string[] {
  const match = text.trim().match(TOOL_CALL_PLACEHOLDER);
  if (!match) return [];
  return [...match[1].matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1]);
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
          tone: "default",
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
  if (entry.kind === "explore_report") {
    return {
      type: "explore_report",
      icon: "search",
      label: "Explore",
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
      tone: "default",
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
        tone: isInteraction ? "warning" : "default",
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
      tone: "default",
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
      record?.status === "error" ||
      record?.status === "denied";
    const humanLoop =
      INTERACTION_TOOLS.has(toolName) ||
      record?.risk === "interaction" ||
      Boolean(record?.approvalId);
    if (humanLoop) {
      badges.push({ icon: "hand", label: "human", tone: "warning" });
    }
    if (isError) {
      badges.push({ icon: "triangle-alert", label: "error", tone: "danger" });
    }
    return {
      type: humanLoop ? "human_loop" : "tool_result",
      icon: toolIcon(toolName),
      label: toolName,
      preview: trimPreview(entry.text),
      tone: isError ? "danger" : humanLoop ? "warning" : "success",
      mono: true,
      badges,
    };
  }

  return {
    type: "system",
    icon: "info",
    label: "System",
    preview: trimPreview(entry.text) || "system entry",
    tone: "default",
    mono: false,
    badges,
  };
}

export type HistoryGraphRow = {
  node: ConversationTreeNode;
  index: number;
  isOnActivePath: boolean;
  isActive: boolean;
  isLeaf: boolean;
  isBranchPoint: boolean;
};

export type HistoryGraph = {
  rows: HistoryGraphRow[];
};

/**
 * Build renderer-neutral metadata for the conversation tree.
 *
 * Rows are emitted in deterministic depth-first chronological order. Layout is
 * deliberately left to the renderer so this model can drive lists, diagrams,
 * and tests without carrying presentation-specific coordinates.
 */
export function buildHistoryGraph(
  treeNodes: ConversationTreeNode[],
  activeEntryId: string | undefined,
): HistoryGraph {
  const byId = new Map(treeNodes.map((node) => [node.entry.id, node]));
  const hasParent = (node: ConversationTreeNode) =>
    node.entry.parentEntryId !== undefined &&
    byId.has(node.entry.parentEntryId);
  const roots = treeNodes.filter((node) => !hasParent(node));

  // Ancestor-or-self chain of the active entry.
  const activePath = new Set<string>();
  if (activeEntryId) {
    let cursor: string | undefined = activeEntryId;
    while (cursor) {
      const node = byId.get(cursor);
      if (!node) break;
      activePath.add(node.entry.id);
      cursor = node.entry.parentEntryId;
    }
  }

  const rows: HistoryGraphRow[] = [];
  const visited = new Set<string>();
  let index = 0;

  const childrenOf = (node: ConversationTreeNode): ConversationTreeNode[] =>
    node.childEntryIds
      .map((id) => byId.get(id))
      .filter((child): child is ConversationTreeNode => Boolean(child));

  const walk = (node: ConversationTreeNode) => {
    if (visited.has(node.entry.id)) return;
    visited.add(node.entry.id);
    const children = childrenOf(node);
    rows.push({
      node,
      index: ++index,
      isOnActivePath: activePath.has(node.entry.id),
      isActive: node.entry.id === activeEntryId,
      isLeaf: children.length === 0,
      isBranchPoint: children.length > 1,
    });
    children.forEach(walk);
  };

  roots.forEach(walk);
  // Detached entries (parent missing from the set) render as extra roots.
  treeNodes.forEach(walk);

  return { rows };
}
