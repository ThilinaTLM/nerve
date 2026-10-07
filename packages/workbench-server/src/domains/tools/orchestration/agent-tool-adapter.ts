import {
  asyncSubagentToolNames,
  normalizeAsyncSubagentTools,
} from "@nervekit/contracts/agents";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  type AgentTool,
  type AgentToolResult,
  AgentToolSuspension,
  createAgentToolsFromDefinitions,
} from "@nervekit/harness/agent";
import {
  allToolDefinitions,
  toolDefinitionsByGroup,
} from "@nervekit/tools/catalog";
import { resolveToolAvailability } from "@nervekit/tools/runtime";
import { defaultSettings } from "@nervekit/contracts/settings";
import { type AgentRecord } from "@nervekit/contracts/agents";
import {
  type ToolCallRecord,
  type ToolAuthoritySnapshot,
  type ToolName,
  type UserConfigurableToolName,
  type ValidatedToolArtifact,
} from "@nervekit/contracts/tools";
import type { ToolAnchor } from "../../runs/runtime/conversation-runtime.js";
import type { WorkbenchPermissionContext } from "../permission/types.js";
import type { ToolService } from "../execution/tool-service.js";
import { projectToolCallResult } from "../artifacts/tool-result-projector.js";

/**
 * Restore the originating ordinary actor without overwriting static identity or
 * independent live fences/grants. Config-sensitive host callbacks must use this
 * after approval/restart, never overlay a few fields on latest configuration.
 */
export function getAgentSnapshotForToolCall(
  originalStaticAgent: AgentRecord,
  toolCall: ToolCallRecord,
): AgentRecord {
  const snapshot = toolCall.authoritySnapshot;
  if (
    originalStaticAgent.id !== toolCall.agentId ||
    originalStaticAgent.conversationId !== toolCall.conversationId ||
    originalStaticAgent.projectId !== toolCall.projectId ||
    (snapshot && snapshot.agentId !== toolCall.agentId)
  ) {
    throw new Error(
      "Tool configuration snapshot belongs to a different agent scope.",
    );
  }
  if (
    !snapshot?.configuration ||
    !snapshot.configurationRevision ||
    !snapshot.configurationProvenance ||
    snapshot.configurationProvenance === "legacy_scope_only"
  ) {
    throw new Error(
      "TOOL_CONFIGURATION_SNAPSHOT_UNAVAILABLE: original full configuration is unavailable; explicitly reissue this config-sensitive tool.",
    );
  }
  const configuration = structuredClone(snapshot.configuration);
  return {
    ...structuredClone(originalStaticAgent),
    ...configuration,
    model: configuration.model ?? undefined,
    permissionRuleSetId: configuration.permissionRuleSetId,
    systemPrompt: configuration.systemPrompt ?? undefined,
    configurationRevision: snapshot.configurationRevision,
    effectiveConfigurationRevision:
      snapshot.configurationProvenance === "resolved"
        ? snapshot.configurationRevision
        : 0,
  };
}

export function createAgentToolsForAgent(
  agent: AgentRecord,
  tools: ToolService,
  options: {
    permissionContext?: WorkbenchPermissionContext;
    toolAuthority?: ToolAuthoritySnapshot;
    runId?: string;
    resolveToolAnchor?: (providerToolCallId: string) => ToolAnchor | undefined;
    hidden?: boolean;
    allowedToolNames?: ToolName[];
    onLifecycle?: (toolCall: ToolCallRecord) => Promise<void>;
  } = {},
): AgentTool[] {
  const agentSnapshot = structuredClone(agent);
  const permissionContext = options.permissionContext
    ? Promise.resolve(structuredClone(options.permissionContext))
    : tools.capturePermissionContext(agentSnapshot);
  const toolAuthority = options.toolAuthority
    ? Promise.resolve(structuredClone(options.toolAuthority))
    : permissionContext.then((context) =>
        tools.captureToolAuthority(agentSnapshot, context),
      );
  void toolAuthority.catch(() => undefined);
  // Construction can fail even if the model produces no tools; keep the
  // shared capture observed and let invoked handlers propagate its failure.
  void permissionContext.catch(() => undefined);
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
        agentSnapshot,
        permissionContext: await permissionContext,
        toolAuthority: await toolAuthority,
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
    imageGenerationAvailable?: boolean;
    primaryModelSupportsImages?: boolean;
  } = {},
): ToolName[] {
  for (const name of agent.tools ?? []) {
    if (!allToolDefinitions.some((definition) => definition.name === name)) {
      throw new Error(
        `Agent configuration references an unregistered tool: ${name}`,
      );
    }
  }
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
  if (options.imageGenerationAvailable !== true) {
    unavailable.push("generate_image");
  }

  const disabled = new Set<ToolName>(
    normalizeAsyncSubagentTools(
      options.disabledToolNames ?? defaultSettings.tools.disabled,
    ),
  );
  if (agent.mode === "planning" || agent.permissionLevel === "read_only") {
    for (const name of asyncSubagentToolNames) disabled.add(name);
  }
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
    permissionLevel:
      agent.readOnlyCeiling || agent.workspaceScope.readonly
        ? "read_only"
        : agent.permissionLevel,
    enabledNames:
      agent.tools === null || agent.tools === undefined
        ? undefined
        : agent.tools.filter((name): name is ToolName =>
            allToolDefinitions.some((definition) => definition.name === name),
          ),
    disabledNames: [...disabled],
    unavailableNames: unavailable,
  }).activeToolNames;
}

export function toolCallResultForModel(
  toolCall: ToolCallRecord,
  completePayload?: ValidatedToolArtifact | string,
): AgentToolResult<{ toolCall: { id: string } }> {
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
