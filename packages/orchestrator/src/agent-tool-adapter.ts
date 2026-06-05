import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  type AgentTool,
  type AgentToolResult,
  AgentToolSuspension,
} from "@nerve/agent";
import type { AgentRecord, ToolCallRecord, ToolName } from "@nerve/shared";
import { allToolDefinitions, type CoreToolDefinition } from "@nerve/tools";
import type { ToolAnchor } from "./conversation-runtime.js";
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
  } = {},
): AgentTool[] {
  return allToolDefinitions.map((definition) =>
    wrapCoreToolDefinition(definition, agent, tools, options),
  );
}

export function activeToolNamesForAgent(agent: AgentRecord): ToolName[] {
  if (agent.permissionLevel === "read_only") {
    const tools: ToolName[] = [
      "read",
      "grep",
      "find",
      "ls",
      "process_list",
      "process_logs",
      "ask_user",
      "todos_set",
      "todos_get",
      "plan_mode_enter",
    ];
    if (agent.mode === "planning") {
      tools.push("plan_mode_present", "plan_mode_force_exit");
    }
    return tools;
  }
  if (agent.mode === "planning") {
    return [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "process_list",
      "process_logs",
      "subagent_run",
      "ask_user",
      "todos_set",
      "todos_get",
      "plan_mode_enter",
      "plan_mode_present",
      "plan_mode_force_exit",
    ];
  }
  return [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "process_start",
    "process_stop",
    "process_restart",
    "process_list",
    "process_logs",
    "subagent_run",
    "ask_user",
    "todos_set",
    "todos_get",
    "plan_mode_enter",
  ];
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

function wrapCoreToolDefinition(
  definition: CoreToolDefinition,
  agent: AgentRecord,
  tools: ToolService,
  options: {
    runId?: string;
    resolveToolAnchor?: (providerToolCallId: string) => ToolAnchor | undefined;
  },
): AgentTool {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    execute: async (sourceToolCallId, params, signal) => {
      const toolCall = await tools.requestToolAndWait(
        agent,
        definition.name,
        params as Record<string, unknown>,
        {
          signal,
          sourceToolCallId,
          providerToolCallId: sourceToolCallId,
          runId: options.runId,
          anchor: options.resolveToolAnchor?.(sourceToolCallId),
          durableSuspend: true,
        },
      );
      if (toolCall.status === "completed") return completedToolResult(toolCall);
      if (
        toolCall.status === "waiting_for_user" &&
        (definition.name === "ask_user" ||
          definition.name === "plan_mode_present")
      ) {
        throw new AgentToolSuspension({
          toolCallId: toolCall.id,
          toolName: definition.name,
          reason: `Tool ${definition.name} is awaiting user input.`,
        });
      }
      const message =
        toolCall.error ?? `Tool ${definition.name} ${toolCall.status}.`;
      throw new Error(message);
    },
  };
}

export function completedToolResult(
  toolCall: ToolCallRecord,
): AgentToolResult<unknown> {
  return {
    content: contentBlocksFromResult(toolCall.result) ?? [
      { type: "text", text: formatToolResultForModel(toolCall) },
    ],
    details: {
      toolCall,
      result: toolCall.result,
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
  return blocks;
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
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[...${text.length - maxChars} more characters truncated]`;
}
