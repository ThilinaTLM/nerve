import type { AgentTool, AgentToolResult } from "@nerve/agent";
import type { AgentRecord, CoreToolName, ToolCallRecord } from "@nerve/shared";
import { type CoreToolDefinition, coreToolDefinitions } from "@nerve/tools";
import type { ToolService } from "./tool-service.js";

export type AgentToolPromptMetadata = {
  activeToolNames: string[];
  snippets: Record<string, string>;
  guidelines: string[];
};

export function createAgentToolsForAgent(
  agent: AgentRecord,
  tools: ToolService,
): AgentTool[] {
  return coreToolDefinitions.map((definition) =>
    wrapCoreToolDefinition(definition, agent, tools),
  );
}

export function activeToolNamesForAgent(agent: AgentRecord): CoreToolName[] {
  if (agent.permissionLevel === "read_only") return ["read", "grep", "find", "ls"];
  return ["read", "bash", "edit", "write"];
}

export function toolPromptMetadata(
  activeToolNames: string[],
): AgentToolPromptMetadata {
  const active = new Set(activeToolNames);
  const snippets: Record<string, string> = {};
  const guidelines: string[] = [];
  const seenGuidelines = new Set<string>();

  for (const definition of coreToolDefinitions) {
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
): AgentTool {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    execute: async (_toolCallId, params, signal) => {
      const toolCall = await tools.requestToolAndWait(
        agent,
        definition.name,
        params as Record<string, unknown>,
        { signal },
      );
      if (toolCall.status === "completed") return completedToolResult(toolCall);
      const message =
        toolCall.error ?? `Tool ${definition.name} ${toolCall.status}.`;
      throw new Error(message);
    },
  };
}

function completedToolResult(
  toolCall: ToolCallRecord,
): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: formatToolResultForModel(toolCall) }],
    details: {
      toolCall,
      result: toolCall.result,
    },
  };
}

function formatToolResultForModel(toolCall: ToolCallRecord): string {
  const result = toolCall.result;
  if (result === undefined) return "Tool completed.";
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
