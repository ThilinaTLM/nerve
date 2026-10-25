import type { AgentDocument } from "../infrastructure/configuration/agent-configuration/document-adapters.js";
import { randomUUID } from "node:crypto";
import type {
  AgentConfigurationPort,
  RequestConfigurationCapture,
  ConfigurationPreviewInput,
  ProfileLifecyclePort,
} from "@nervekit/conversation-core";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { ToolDefinition } from "@nervekit/tools/catalog";

export function requireReady(
  resolution: ReturnType<typeof resolveAgentConfiguration>,
) {
  const errors = resolution.diagnostics.filter(
    (issue) =>
      issue.code === "model-required" ||
      issue.code === "unsupported-reasoning" ||
      (issue.code === "missing-reference" && issue.pointer === "/model"),
  );
  if (errors.length)
    throw new Error(
      `Agent configuration is not ready: ${errors.map((issue) => `${issue.code} ${issue.pointer}`).join(", ")}`,
    );
  if (!resolution.settings.model)
    throw new Error("Agent configuration requires a model");
  return resolution.settings.model;
}

/** Captures are retained only in process memory; admission owns their association with calls. */
export function createScopedAgentConfiguration(options: {
  service: AgentConfigurationService;
  workingDirectory(conversationId: string): string | undefined;
  initializeConversation: AgentConfigurationPort["initializeConversation"];
  prepareCreation: AgentConfigurationPort["prepareCreation"];
  profiles: ProfileLifecyclePort;
  /** Non-secret account definitions and other non-agent execution resources. */
  captureExecutorResources(
    input: ConfigurationPreviewInput,
    settings: LeadSettingsOverrides,
  ): unknown | Promise<unknown>;
  resourcesGeneration(): number;
  prepare(
    input: ConfigurationPreviewInput,
    settings: LeadSettingsOverrides,
    instructions: string,
    missingReferences: readonly string[],
  ): Promise<{ systemPrompt: string; tools: ToolDefinition[] }>;
}) {
  const captures = new Map<
    string,
    {
      conversationId: string;
      settings: LeadSettingsOverrides;
      executorResources: unknown;
      generations: Record<string, number>;
    }
  >();
  const directory = (id: string) => {
    const path = options.workingDirectory(id);
    if (path === undefined) throw new Error("Conversation not found");
    return path;
  };
  const port: AgentConfigurationPort = {
    historyContext: (id) => options.service.getConversationContext(id) ?? {},
    configureContext: (id, patch) =>
      options.service.configureContext(id, patch),
    summary(id) {
      const cached = options.service.getSummary(id);
      if (!cached) return {};
      const { observedDigest, ...fields } = cached;
      void observedDigest;
      return fields;
    },
    async resolveConfig(id, context) {
      const view = await options.service.getEffective(id);
      if (view.status !== "available")
        throw new Error("Agent configuration unavailable");
      const model = requireReady(view.resolution);
      const document = view.sources.find(
        (source) => source.scope.scope === "conversation",
      )?.document;
      return {
        ...context,
        ...documentContext(document),
        workingDirectory: directory(id),
        conversationId: id,
        model,
        reasoningLevel: view.resolution.settings.reasoningLevel!,
        permissionRuleSetId: view.resolution.settings.permissionRuleSetId!,
        agentProfile:
          document && "appliedProfile" in document
            ? (document.appliedProfile?.name ?? "coding")
            : "coding",
      };
    },
    releaseRequest: (id) => {
      captures.delete(id);
    },
    initializeConversation: options.initializeConversation,
    prepareCreation: options.prepareCreation,
    profiles: options.profiles,
    async capturePreview(input) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (input.conversation.id) {
          const capture = await options.service.captureEffective(
            input.conversation.id,
          );
          if (capture.view.status !== "available")
            return {
              status: "unavailable",
              diagnostics: [...capture.view.diagnostics],
            };
          const document = capture.view.sources.find(
            (source) => source.scope.scope === "conversation",
          )?.document;
          const applied =
            document && "appliedProfile" in document
              ? document.appliedProfile
              : null;
          const workingDirectory = directory(input.conversation.id);
          const result = await options.prepare(
            {
              ...input,
              config: {
                ...input.config,
                ...documentContext(document),
                workingDirectory,
              },
            },
            capture.view.resolution.settings,
            applied?.instructions ?? "",
            capture.view.resolution.diagnostics
              .filter((issue) => issue.code === "missing-reference")
              .map((issue) => issue.pointer),
          );
          if (
            capture.isCurrent() &&
            options.workingDirectory(input.conversation.id) === workingDirectory
          )
            return {
              status: "available",
              ...result,
              resolution: capture.view.resolution,
            };
        } else {
          const capture = await options.service.projectDefaults.capture({
            projectId: input.conversation.projectId,
            agentProfile: input.agentProfile,
            overrides: input.overrides,
          });
          if (capture.view.status === "unavailable") return capture.view;
          const { resolution, appliedProfile } = capture.view;
          const result = await options.prepare(
            input,
            resolution.settings,
            appliedProfile.instructions,
            resolution.diagnostics
              .filter((issue) => issue.code === "missing-reference")
              .map((issue) => issue.pointer),
          );
          if (capture.isCurrent())
            return { status: "available", ...result, resolution };
        }
      }
      return {
        status: "unavailable",
        diagnostics: [
          {
            scope: "project",
            scopeId: input.conversation.projectId,
            document: "agent",
            path: "config/agent.json",
            code: "dependencies-changing",
            pointer: "",
            affectedCapability: "preview",
            recoveryChoices: ["retry"],
          },
        ],
      };
    },
    async captureRequest(input): Promise<RequestConfigurationCapture> {
      const id = input.conversation.id;
      if (!id)
        throw new Error("Request capture requires a conversation identity");
      while (true) {
        input.signal?.throwIfAborted();
        const capture = await options.service.captureEffective(id);
        if (capture.view.status !== "available")
          throw new Error("Agent configuration unavailable");
        const { resolution, sources } = capture.view;
        const model = requireReady(resolution);
        const document = sources.find(
          (source) => source.scope.scope === "conversation",
        )?.document;
        const applied =
          document && "appliedProfile" in document
            ? document.appliedProfile
            : null;
        const workingDirectory = directory(id);
        const currentInput = {
          ...input,
          config: {
            ...input.config,
            ...documentContext(document),
            workingDirectory,
          },
        };
        const executorResources = await options.captureExecutorResources(
          currentInput,
          resolution.settings,
        );
        const resources = await options.prepare(
          currentInput,
          resolution.settings,
          applied?.instructions ?? "",
          resolution.diagnostics
            .filter((issue) => issue.code === "missing-reference")
            .map((issue) => issue.pointer),
        );
        input.signal?.throwIfAborted();
        const isCurrent = () =>
          capture.isCurrent() &&
          options.workingDirectory(id) === workingDirectory;
        if (!isCurrent()) continue;
        const captureId = randomUUID();
        captures.set(captureId, {
          conversationId: id,
          settings: structuredClone(resolution.settings),
          executorResources: structuredClone(executorResources),
          generations: {
            ...Object.fromEntries(
              sources.map((source) => [
                `agent:${source.path}`,
                source.generation,
              ]),
            ),
            resources: options.resourcesGeneration(),
          },
        });
        return {
          id: captureId,
          model: structuredClone(model),
          reasoningLevel: resolution.settings.reasoningLevel!,
          agentProfile: applied?.name ?? "coding",
          ...resources,
          isCurrent,
        };
      }
    },
    async captureCompaction(id) {
      const capture = await options.service.captureEffective(id);
      if (capture.view.status !== "available")
        throw new Error("Agent configuration unavailable");
      const model = requireReady(capture.view.resolution);
      const settings = capture.view.resolution.settings;
      return {
        model,
        reasoningLevel: settings.reasoningLevel!,
        settings: settings.compaction as Required<
          NonNullable<LeadSettingsOverrides["compaction"]>
        >,
        isCurrent: capture.isCurrent,
      };
    },
    async captureRetry(id) {
      while (true) {
        const capture = await options.service.captureEffective(id);
        if (capture.view.status !== "available")
          throw new Error("Agent configuration unavailable");
        if (!capture.isCurrent()) continue;
        return structuredClone(
          capture.view.resolution.settings.retry,
        ) as Required<NonNullable<LeadSettingsOverrides["retry"]>>;
      }
    },
  };
  return {
    port,
    /** Caller must validate conversation identity. Never use this capture as permission authority. */
    getCapture: (id: string) => {
      const capture = captures.get(id);
      return capture && structuredClone(capture);
    },
    releaseCapture: (id: string) => captures.delete(id),
  };
}

function documentContext(document: AgentDocument | undefined) {
  if (!document || !("appliedProfile" in document))
    throw new Error("Conversation JSON context unavailable");
  return {
    instructions: document.context?.instructions ?? null,
    systemPrompt: document.context?.systemPrompt ?? null,
  };
}
