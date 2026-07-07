import { access } from "node:fs/promises";
import path from "node:path";
import {
  type AgentCustomModel,
  AgentHarness,
  type AgentTool,
  type AgentToolResult,
  Conversation,
  clampAgentThinkingLevel,
  formatSkillsForSystemPrompt,
  JsonlConversationStorage,
  NodeExecutionEnv,
  resolveAgentModel,
  type Skill,
} from "@nervekit/agent";
import type { SandboxConfigV1, SkillStatus } from "@nervekit/shared";
import { allToolDefinitions } from "@nervekit/tools";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import { resolveModelSelection } from "../models/model-catalog.js";
import { resolveProviderCredential } from "../models/provider-credentials.js";
import { Redactor } from "../security/redaction.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { AgentConfigStore } from "./agent-config-store.js";

export type HarnessFactoryOptions = {
  workspaceDir: string;
  stateDir: string;
  toolRuntime?: SandboxToolRuntime;
  secretResolver?: SecretResolver;
  skills?: SkillStatus[];
  contextFiles?: Array<{ path?: string; included?: boolean }>;
  redactor?: Redactor;
  configStore?: AgentConfigStore;
};

export type SandboxHarnessDescriptor = {
  conversationPath: string;
  model: {
    provider: string;
    model?: string;
    status: "available" | "unavailable" | "degraded";
    limitations?: string[];
  };
  tools: string[];
};

export type SandboxHarnessRunScope = {
  conversationId: string;
  agentId: string;
  runId: string;
  executionId: string;
};
export type HarnessCreateOptions = {
  modelSelection?: SandboxConfigV1["agent"]["mainModel"];
  systemPromptAmendment?: string;
  activeToolNames?: string[];
  toolRuntime?: SandboxToolRuntime;
  followUpMode?: "one-at-a-time";
  steeringMode?: "one-at-a-time";
};

export class HarnessFactory {
  private readonly redactor: Redactor;
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly options: HarnessFactoryOptions,
  ) {
    this.redactor = options.redactor ?? new Redactor({ secrets: [] });
  }

  conversationPath(conversationId: string, agentId: string): string {
    return path.join(
      this.options.stateDir,
      "conversations",
      conversationId,
      "agents",
      agentId,
      "conversation.jsonl",
    );
  }

  async openOrCreateConversation(
    conversationId: string,
    agentId: string,
  ): Promise<Conversation> {
    const env = new NodeExecutionEnv({ cwd: this.options.workspaceDir });
    const filePath = this.conversationPath(conversationId, agentId);
    const storage = (await exists(filePath))
      ? await JsonlConversationStorage.open(env, filePath)
      : await JsonlConversationStorage.create(env, filePath, {
          cwd: this.options.workspaceDir,
          conversationId,
        });
    return new Conversation(storage);
  }

  async create(
    scope: SandboxHarnessRunScope,
    options: HarnessCreateOptions = {},
  ): Promise<AgentHarness> {
    const selection =
      options.modelSelection ??
      this.options.configStore?.effective(this.config).model ??
      this.config.agent.mainModel;
    const customModels = this.customModels();
    const model = resolveAgentModel(
      { provider: selection.provider, modelId: selection.model },
      customModels,
    );
    const thinkingLevel = clampAgentThinkingLevel(
      { provider: selection.provider, modelId: selection.model },
      selection.thinkingLevel,
      customModels,
    );
    const env = new NodeExecutionEnv({ cwd: this.options.workspaceDir });
    const conversation = await this.openOrCreateConversation(
      scope.conversationId,
      scope.agentId,
    );
    const tools = this.buildTools(scope, options);
    return new AgentHarness({
      env,
      conversation,
      model,
      thinkingLevel,
      tools,
      activeToolNames:
        options.activeToolNames ?? tools.map((tool) => tool.name),
      resources: { skills: this.skills() },
      systemPrompt: () =>
        this.systemPrompt(tools, options.systemPromptAmendment),
      getApiKeyAndHeaders: async (requestModel) =>
        this.getApiKeyAndHeaders(requestModel.provider),
      followUpMode: options.followUpMode ?? "one-at-a-time",
      steeringMode: options.steeringMode ?? "one-at-a-time",
    });
  }

  describe(
    conversationId: string,
    agentId: string,
    options: Pick<
      HarnessCreateOptions,
      "modelSelection" | "toolRuntime" | "activeToolNames"
    > = {},
  ): SandboxHarnessDescriptor {
    const model = resolveModelSelection(
      this.config,
      options.modelSelection ??
        this.options.configStore?.effective(this.config).model ??
        this.config.agent.mainModel,
    );
    const provider = this.providerConfig(model.provider);
    const needsCredential = providerNeedsCredential(model.provider);
    const credentialMissing = needsCredential && !provider?.credential;
    return {
      conversationPath: this.conversationPath(conversationId, agentId),
      model: {
        provider: model.provider,
        model: model.model,
        status: credentialMissing ? "unavailable" : "available",
        limitations: [
          ...model.limitations,
          ...(model.provider === "nerve-scripted"
            ? ["test/dev-only scripted provider"]
            : []),
          ...(credentialMissing
            ? ["provider credential is not configured"]
            : []),
        ].filter(Boolean),
      },
      tools: this.activeToolNames(options),
    };
  }

  async assertModelAvailable(
    selection?: SandboxConfigV1["agent"]["mainModel"],
  ): Promise<void> {
    const effectiveSelection =
      selection ??
      this.options.configStore?.effective(this.config).model ??
      this.config.agent.mainModel;
    const provider = this.providerConfig(effectiveSelection.provider);
    if (provider?.credential && this.options.secretResolver) {
      await resolveProviderCredential(
        provider.credential,
        this.options.secretResolver,
      );
      return;
    }
    if (
      providerNeedsCredential(effectiveSelection.provider) &&
      !provider?.credential
    ) {
      throw new Error("UNAVAILABLE: selected model provider has no credential");
    }
  }

  private customModels(): AgentCustomModel[] {
    const providers = this.config.modelCatalog?.providers ?? [];
    return (this.config.modelCatalog?.models ?? []).map((model) => {
      const provider = providers.find((entry) => entry.id === model.provider);
      return {
        provider: model.provider,
        modelId: model.model,
        name:
          model.displayName ?? model.id ?? `${model.provider}/${model.model}`,
        api: provider?.api,
        baseUrl: provider?.baseUrl,
        headers: provider?.headers,
        compat: provider?.compat,
        reasoning: Boolean(model.supportsThinking),
        contextWindow: model.contextWindow,
        maxTokens: model.maxOutputTokens,
      } satisfies AgentCustomModel;
    });
  }

  private providerConfig(providerId: string) {
    return (this.config.modelCatalog?.providers ?? []).find(
      (provider) => provider.id === providerId,
    );
  }
  private async getApiKeyAndHeaders(providerId: string): Promise<
    | {
        apiKey: string;
        headers?: Record<string, string>;
        env?: Record<string, string>;
      }
    | undefined
  > {
    const provider = this.providerConfig(providerId);
    const headers = { ...(provider?.headers ?? {}) };
    const env = provider?.env ? { ...provider.env } : undefined;
    if (!provider?.credential)
      return Object.keys(headers).length || env
        ? { apiKey: "", headers, env }
        : undefined;
    if (!this.options.secretResolver)
      throw new Error("UNAVAILABLE: secret resolver is not configured");
    const resolved = await resolveProviderCredential(
      provider.credential,
      this.options.secretResolver,
    );
    if (resolved.apiKey) return { apiKey: resolved.apiKey, headers, env };
    if (resolved.bearerToken) {
      if (providerUsesApiKeySlotForBearer(providerId)) {
        return { apiKey: resolved.bearerToken, headers, env };
      }
      headers.authorization = `Bearer ${resolved.bearerToken}`;
      return { apiKey: "", headers, env };
    }
    if (resolved.username || resolved.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${resolved.username ?? ""}:${resolved.password ?? ""}`,
      ).toString("base64")}`;
      return { apiKey: "", headers, env };
    }
    if (resolved.accessToken) {
      headers.authorization = `Bearer ${resolved.accessToken}`;
      return { apiKey: "", headers, env };
    }
    return Object.keys(headers).length || env
      ? { apiKey: "", headers, env }
      : undefined;
  }

  private buildTools(
    scope: SandboxHarnessRunScope,
    options: Pick<HarnessCreateOptions, "toolRuntime" | "activeToolNames"> = {},
  ): AgentTool[] {
    const toolRuntime = options.toolRuntime ?? this.options.toolRuntime;
    if (!toolRuntime) return [];
    const active = new Set(this.activeToolNames(options));
    return allToolDefinitions
      .filter((definition) => active.has(definition.name))
      .map((definition) => ({
        name: definition.name,
        label: definition.label,
        description: definition.description,
        parameters: definition.parameters,
        prepareArguments: definition.prepareArguments,
        executionMode: definition.executionMode,
        execute: async (toolCallId, params, signal, onUpdate) => {
          const result = await toolRuntime.execute(
            definition.name,
            params as Record<string, unknown>,
            {
              conversationId: scope.conversationId,
              agentId: scope.agentId,
              runId: scope.runId,
              executionId: scope.executionId,
              toolCallId,
              signal,
              onUpdate: (update: { chunk?: unknown }) => {
                if ("chunk" in update) {
                  onUpdate?.({
                    content: [
                      {
                        type: "text",
                        text: String(update.chunk).slice(0, 16_000),
                      },
                    ],
                    details: this.redactor.redact(update),
                  });
                }
              },
            } as never,
          );
          return toolResult(result, this.redactor);
        },
      }));
  }

  private activeToolNames(
    options: Pick<HarnessCreateOptions, "toolRuntime" | "activeToolNames"> = {},
  ): string[] {
    if (options.activeToolNames) return options.activeToolNames;
    const toolRuntime = options.toolRuntime ?? this.options.toolRuntime;
    return toolRuntime
      ? toolRuntime
          .groups()
          .flatMap((group) => (group.active ? group.tools : []))
      : [];
  }

  private skills(): Skill[] {
    return (this.options.skills ?? [])
      .filter((skill) => skill.modelVisible !== false)
      .map((skill) => ({
        name: skill.name,
        description: `Sandbox skill from ${skill.source}`,
        content: `Use the ${skill.name} skill when relevant. Full instructions are available at ${skill.path}.`,
        filePath: skill.path,
      }));
  }

  private systemPrompt(tools: AgentTool[], amendment?: string): string {
    const contextFiles = (this.options.contextFiles ?? [])
      .map(
        (file) =>
          `- ${file.path ?? "context"}: ${file.included === false ? "skipped" : "included"}`,
      )
      .join("\n");
    const toolSummary = tools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
    const skillsPrompt = formatSkillsForSystemPrompt(this.skills());
    return [
      "You are Nerve running inside a sandboxed workspace.",
      `Mode: ${this.config.agent.mode ?? "normal"}.`,
      `Permission level: ${this.config.agent.permissionLevel ?? "supervised"}.`,
      `Workspace root: ${this.options.workspaceDir}.`,
      toolSummary
        ? `Available sandbox tools:\n${toolSummary}`
        : "No sandbox tools are active.",
      contextFiles ? `Loaded context summaries:\n${contextFiles}` : undefined,
      skillsPrompt || undefined,
      amendment,
      this.config.agent.systemPromptAmendment,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

function providerUsesApiKeySlotForBearer(providerId: string): boolean {
  return providerId === "openai-codex";
}

function providerNeedsCredential(provider: string): boolean {
  return !(
    provider === "ollama" ||
    provider === "nerve-faux" ||
    provider.startsWith("nerve-faux-") ||
    provider === "nerve-scripted" ||
    provider.startsWith("nerve-scripted-")
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toolResult(
  result: unknown,
  redactor: Redactor,
): AgentToolResult<unknown> {
  const record = redactor.redact(result) as {
    content?: unknown;
    contentBlocks?: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    details?: unknown;
  };
  const content: AgentToolResult<unknown>["content"] = [];
  if (Array.isArray(record.contentBlocks) && record.contentBlocks.length) {
    for (const block of record.contentBlocks) {
      if (block.type === "text")
        content.push({
          type: "text",
          text: String(block.text ?? "").slice(0, 64_000),
        });
      if (block.type === "image")
        content.push({
          type: "image",
          data: String(block.data ?? ""),
          mimeType: String(block.mimeType ?? "application/octet-stream"),
        });
    }
  }
  if (!content.length) {
    content.push({
      type: "text",
      text: String(record.content ?? JSON.stringify(record)).slice(0, 64_000),
    });
  }
  return { content, details: record.details ?? record };
}
