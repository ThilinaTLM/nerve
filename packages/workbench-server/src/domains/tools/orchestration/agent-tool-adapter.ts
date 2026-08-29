import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  type AgentTool,
  type AgentToolResult,
  AgentToolSuspension,
  createAgentToolsFromDefinitions,
} from "@nervekit/harness";
import {
  allToolDefinitions,
  resolveToolAvailability,
  toolDefinitionsByGroup,
} from "@nervekit/tools";
import {
  type AgentRecord,
  type ToolCallRecord,
  type ToolName,
  type UserConfigurableToolName,
  type ValidatedToolArtifact,
} from "@nervekit/contracts";
import type { ToolAnchor } from "../../runs/runtime/conversation-runtime.js";
import type { ToolService } from "../execution/tool-service.js";
import { projectToolCallResult } from "../artifacts/tool-result-projector.js";

export function createAgentToolsForAgent(
  agent: AgentRecord,
  tools: ToolService,
  options: {
    runId?: string;
    resolveToolAnchor?: (providerToolCallId: string) => ToolAnchor | undefined;
    hidden?: boolean;
    allowedToolNames?: ToolName[];
    onLifecycle?: (toolCall: ToolCallRecord) => Promise<void>;
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
        onLifecycle: options.onLifecycle,
      });
      if (toolCall.status === "completed")
        return toolCallResultForModel(
          toolCall,
          tools.toolResultRecoveryArtifact(toolCall),
        );
      if (toolCall.status === "waiting") {
        throw new AgentToolSuspension({
          toolCallId: toolCall.id,
          toolName,
          reason: `Tool ${toolName} is awaiting user input.`,
        });
      }
      throw new Error(formatToolResultForModel(toolCall));
    },
  );
}

export function activeToolNamesForExploreAgent(): ToolName[] {
  return resolveToolAvailability({
    permissionLevel: "read_only",
    enabledNames: ["read", "grep", "find", "ls", "task_status", "task_logs"],
  }).activeToolNames;
}

export function activeToolNamesForAgent(
  agent: AgentRecord,
  options: {
    pythonAvailable?: boolean;
    disabledToolNames?: readonly UserConfigurableToolName[];
    jiraEnabled?: boolean;
    confluenceEnabled?: boolean;
    imageExplanationAvailable?: boolean;
    primaryModelSupportsImages?: boolean;
  } = {},
): ToolName[] {
  const unavailable: ToolName[] = [];
  if (options.pythonAvailable !== true) unavailable.push("python_exec");
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
  if (
    options.imageExplanationAvailable !== true ||
    options.primaryModelSupportsImages === true
  ) {
    unavailable.push("explain_image");
  }

  const disabled = new Set<ToolName>(options.disabledToolNames ?? []);
  if (agent.mode === "planning") {
    for (const name of ["task_start", "task_control"] as ToolName[]) {
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

export function toolCallResultForModel(
  toolCall: ToolCallRecord,
  completePayload?: ValidatedToolArtifact | string,
): AgentToolResult<unknown> {
  // Bare paths from historical callers are deliberately ignored: only a
  // host-issued descriptor can advertise recoverability.
  const trustedPayload =
    completePayload && typeof completePayload !== "string"
      ? completePayload
      : undefined;
  const projected = projectToolCallResult(toolCall, trustedPayload);
  const content: Array<TextContent | ImageContent> = projected.blocks.map(
    (block) =>
      block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "image", data: block.data, mimeType: block.mimeType },
  );
  return {
    content,
    details: { toolCall: { id: toolCall.id } },
  };
}

export function formatToolResultForModel(toolCall: ToolCallRecord): string {
  return projectToolCallResult(toolCall)
    .blocks.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
