import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  type AgentTool,
  type AgentToolResult,
  AgentToolSuspension,
  createAgentToolsFromDefinitions,
} from "@nervekit/host-runtime/harness";
import {
  allToolDefinitions,
  appendBoundedTextNotice,
  boundContentBlocks,
  boundText,
  MODEL_TEXT_MAX_LINE_CHARS,
  MODEL_TEXT_MAX_LINES,
  resolveToolAvailability,
  toolDefinitionsByGroup,
} from "@nervekit/host-runtime/tools";
import type {
  AgentRecord,
  ToolAnchor,
  ToolCallRecord,
  ToolName,
  UserConfigurableToolName,
} from "@nervekit/contracts";
import type { ToolService } from "./tool-service.js";

export type AgentToolPromptMetadata = {
  activeToolNames: string[];
  snippets: Record<string, string>;
  guidelines: string[];
};

export function createAgentToolsForAgent(
  agent: AgentRecord,
  tools: ToolService,
  options: {
    runId?: string;
    resolveToolAnchor?: (providerToolCallId: string) => ToolAnchor | undefined;
    hidden?: boolean;
    allowedToolNames?: ToolName[];
  } = {},
): AgentTool[] {
  const allowed = options.allowedToolNames
    ? new Set<string>(options.allowedToolNames)
    : undefined;
  return createAgentToolsFromDefinitions(
    allToolDefinitions,
    allowed,
    async (definition, sourceToolCallId, params, signal) => {
      const toolName = definition.name as ToolName;
      const toolCall = await tools.requestToolAndWait(agent, toolName, params, {
        signal,
        sourceToolCallId,
        providerToolCallId: sourceToolCallId,
        runId: options.runId,
        anchor: options.resolveToolAnchor?.(sourceToolCallId),
        durableSuspend: true,
        hidden: options.hidden === true ? true : undefined,
      });
      if (toolCall.status === "completed") return completedToolResult(toolCall);
      if (
        toolCall.status === "pending_approval" ||
        (toolCall.status === "waiting_for_user" &&
          (toolName === "ask_user" || toolName === "plan_mode_present"))
      ) {
        throw new AgentToolSuspension({
          toolCallId: toolCall.id,
          toolName,
          reason: `Tool ${toolName} is awaiting user input.`,
        });
      }
      throw new Error(toolCall.error ?? `Tool ${toolName} ${toolCall.status}.`);
    },
  );
}

export function activeToolNamesForExploreAgent(): ToolName[] {
  return resolveToolAvailability({
    permissionLevel: "read_only",
    enabledNames: [
      "read",
      "grep",
      "find",
      "ls",
      "task_status",
      "task_logs",
      "task_list",
    ],
  }).activeToolNames;
}

export function activeToolNamesForAgent(
  agent: AgentRecord,
  options: {
    pythonAvailable?: boolean;
    disabledToolNames?: readonly UserConfigurableToolName[];
    jiraEnabled?: boolean;
    confluenceEnabled?: boolean;
  } = {},
): ToolName[] {
  const unavailable: ToolName[] = [];
  if (options.pythonAvailable !== true) unavailable.push("python");
  if (options.jiraEnabled !== true) {
    unavailable.push(
      ...toolDefinitionsByGroup("jira").map((tool) => tool.name),
    );
  }
  if (options.confluenceEnabled !== true) {
    unavailable.push(
      ...toolDefinitionsByGroup("confluence").map((tool) => tool.name),
    );
  }

  const disabled = new Set<ToolName>(options.disabledToolNames ?? []);
  if (agent.mode === "planning") {
    for (const name of [
      "task_start",
      "task_cancel",
      "task_restart",
    ] as ToolName[]) {
      disabled.add(name);
    }
    for (const group of ["jira", "confluence"] as const) {
      for (const definition of toolDefinitionsByGroup(group)) {
        if (definition.traits.includes("write_capable"))
          disabled.add(definition.name);
      }
    }
  } else {
    disabled.add("plan_mode_present");
    disabled.add("plan_mode_force_exit");
  }

  return resolveToolAvailability({
    permissionLevel: agent.permissionLevel,
    disabledNames: [...disabled],
    unavailableNames: unavailable,
  }).activeToolNames;
}

export function toolPromptMetadata(
  activeToolNames: string[],
): AgentToolPromptMetadata {
  const active = new Set(activeToolNames);
  const snippets: Record<string, string> = {};
  const guidelines: string[] = [];
  const seenGuidelines = new Set<string>();

  for (const definition of allToolDefinitions) {
    if (!active.has(definition.name)) continue;
    if (definition.promptSnippet)
      snippets[definition.name] = definition.promptSnippet;
    for (const guideline of definition.promptGuidelines ?? []) {
      const normalized = guideline.trim();
      if (!normalized || seenGuidelines.has(normalized)) continue;
      seenGuidelines.add(normalized);
      guidelines.push(normalized);
    }
  }

  return { activeToolNames: [...active], snippets, guidelines };
}

export function completedToolResult(
  toolCall: ToolCallRecord,
): AgentToolResult<unknown> {
  return {
    content: contentBlocksFromResult(toolCall.result) ?? [
      { type: "text", text: formatToolResultForModel(toolCall) },
    ],
    details: {
      toolCall: { id: toolCall.id },
    },
  };
}

export function contentBlocksFromResult(
  result: unknown,
): Array<TextContent | ImageContent> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const contentBlocks = (result as Record<string, unknown>).contentBlocks;
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    return undefined;
  }

  const blocks: Array<TextContent | ImageContent> = [];
  for (const block of contentBlocks) {
    if (!block || typeof block !== "object") return undefined;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      blocks.push({ type: "text", text: record.text });
      continue;
    }
    if (
      record.type === "image" &&
      typeof record.data === "string" &&
      typeof record.mimeType === "string"
    ) {
      blocks.push({
        type: "image",
        data: record.data,
        mimeType: record.mimeType,
      });
      continue;
    }
    return undefined;
  }
  const bounded = boundContentBlocks(
    blocks,
    {
      maxBytes: 24_000,
      maxLines: MODEL_TEXT_MAX_LINES,
      maxLineChars: MODEL_TEXT_MAX_LINE_CHARS,
    },
    {
      recoveryHint:
        "Full result remains in the tool call record; use tool-specific continuation arguments, transcripts, or raw result paths when available.",
    },
  );
  return bounded.contentBlocks;
}

export function formatToolResultForModel(toolCall: ToolCallRecord): string {
  const result = toolCall.result;
  if (result === undefined) return "Tool completed.";
  if (
    toolCall.toolName === "ask_user" &&
    result &&
    typeof result === "object"
  ) {
    const record = result as Record<string, unknown>;
    if (record.dismissed === true) {
      return `User dismissed the question.${
        typeof record.dismissedReason === "string"
          ? `\nReason: ${record.dismissedReason}`
          : ""
      }`;
    }
    if (typeof record.response === "string") {
      return `User replied:\n${record.response}`;
    }
  }
  if (typeof result === "string") return truncate(result, 24_000);
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.content === "string") parts.push(record.content);
    if (typeof record.stdout === "string" && record.stdout.length > 0) {
      parts.push(`stdout:\n${record.stdout}`);
    }
    if (typeof record.stderr === "string" && record.stderr.length > 0) {
      parts.push(`stderr:\n${record.stderr}`);
    }
    if (typeof record.exitCode === "number")
      parts.push(`exitCode: ${record.exitCode}`);
    if (Array.isArray(record.entries)) {
      parts.push(
        `entries:\n${record.entries
          .map((entry) => JSON.stringify(entry))
          .join("\n")}`,
      );
    }
    if (Array.isArray(record.matches)) {
      parts.push(
        `matches:\n${record.matches
          .map((entry) => JSON.stringify(entry))
          .join("\n")}`,
      );
    }
    if (parts.length > 0) return truncate(parts.join("\n\n"), 24_000);
  }
  return truncate(JSON.stringify(result, null, 2), 24_000);
}

function truncate(text: string, maxChars: number): string {
  const bounded = boundText(text, {
    maxBytes: maxChars,
    maxLines: MODEL_TEXT_MAX_LINES,
    maxLineChars: MODEL_TEXT_MAX_LINE_CHARS,
  });
  return appendBoundedTextNotice(bounded, {
    label: "tool result",
    recoveryHint:
      "Full result remains in the tool call record; use tool-specific continuation arguments, transcripts, or raw result paths when available.",
  });
}
