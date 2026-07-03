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

export type HarnessFactoryOptions = {
  workspaceDir: string;
  stateDir: string;
  toolRuntime?: SandboxToolRuntime;
  secretResolver?: SecretResolver;
  skills?: SkillStatus[];
  contextFiles?: Array<{ path?: string; included?: boolean }>;
  redactor?: Redactor;
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

  async create(scope: SandboxHarnessRunScope): Promise<AgentHarness> {
    const selection = this.config.agent.mainModel;
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
    const tools = this.buildTools(scope);
    return new AgentHarness({
      env,
      conversation,
      model,
      thinkingLevel,
      tools,
      activeToolNames: tools.map((tool) => tool.name),
      resources: { skills: this.skills() },
      systemPrompt: () => this.systemPrompt(tools),
      getApiKeyAndHeaders: async (requestModel) =>
        this.getApiKeyAndHeaders(requestModel.provider),
      followUpMode: "one-at-a-time",
      steeringMode: "one-at-a-time",
    });
  }

  describe(conversationId: string, agentId: string): SandboxHarnessDescriptor {
    const model = resolveModelSelection(
      this.config,
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
      tools: this.activeToolNames(),
    };
  }

  async assertModelAvailable(): Promise<void> {
    const provider = this.providerConfig(this.config.agent.mainModel.provider);
    if (provider?.credential && this.options.secretResolver) {
      await resolveProviderCredential(
        provider.credential,
        this.options.secretResolver,
      );
      return;
    }
    if (
      providerNeedsCredential(this.config.agent.mainModel.provider) &&
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

  private async getApiKeyAndHeaders(
    providerId: string,
  ): Promise<{ apiKey: string; headers?: Record<string, string> } | undefined> {
    const provider = this.providerConfig(providerId);
    const headers = { ...(provider?.headers ?? {}) };
    if (!provider?.credential)
      return Object.keys(headers).length ? { apiKey: "", headers } : undefined;
    if (!this.options.secretResolver)
      throw new Error("UNAVAILABLE: secret resolver is not configured");
    const resolved = await resolveProviderCredential(
      provider.credential,
      this.options.secretResolver,
    );
    if (resolved.apiKey) return { apiKey: resolved.apiKey, headers };
    if (resolved.bearerToken) {
      headers.authorization = `Bearer ${resolved.bearerToken}`;
      return { apiKey: "", headers };
    }
    if (resolved.username || resolved.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${resolved.username ?? ""}:${resolved.password ?? ""}`,
      ).toString("base64")}`;
      return { apiKey: "", headers };
    }
    if (resolved.accessToken) {
      headers.authorization = `Bearer ${resolved.accessToken}`;
      return { apiKey: "", headers };
    }
    return Object.keys(headers).length ? { apiKey: "", headers } : undefined;
  }

  private buildTools(scope: SandboxHarnessRunScope): AgentTool[] {
    const toolRuntime = this.options.toolRuntime;
    if (!toolRuntime) return [];
    const active = new Set(this.activeToolNames());
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

  private activeToolNames(): string[] {
    return this.options.toolRuntime
      ? this.options.toolRuntime
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

  private systemPrompt(tools: AgentTool[]): string {
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
      this.config.agent.systemPromptAmendment,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

function providerNeedsCredential(provider: string): boolean {
  return !["ollama", "nerve-faux", "nerve-scripted"].includes(provider);
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
