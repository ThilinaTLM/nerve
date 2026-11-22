import {
  thinkingLevelSchema,
  type ModelSelection as ResolvableModel,
  type ThinkingLevel,
} from "@nervekit/contracts/models";
import { ExtensionError, type ModelSelection } from "@nervekit/extension-api";
import { streamSimpleWithModel } from "@nervekit/harness/models";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { ModelConfiguration } from "./model.adapter.js";

type Resolve = (
  selection: ResolvableModel,
  configuration: ModelConfiguration,
) => Promise<{
  model: Parameters<typeof streamSimpleWithModel>[0];
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}>;

/** What a project's default resolves to: the selection and its reasoning level. */
type Target = { selection: ResolvableModel; reasoningLevel: ThinkingLevel };

/**
 * The host side of `ctx.models.text`: one direct model call without tools, on the
 * model of the request. The extension runtime has already checked the selection;
 * this host reads no settings.
 */
export type TextHost = {
  /** Whether the model resolves with credentials. */
  ready(model: ModelSelection): Promise<boolean>;
  complete(request: {
    model: ModelSelection;
    system?: string | undefined;
    prompt: string;
    maxTokens?: number | undefined;
    onDelta?:
      | ((update: { kind: "thinking" | "text"; delta: string }) => void)
      | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<{ text: string; model: string }>;
  /** Nerve's default lead model and reasoning level for the project. */
  defaultModel(projectId: string): Promise<ModelSelection | undefined>;
};

export function createTextHost(input: {
  models: { resolve: Resolve };
  configuration: () => ModelConfiguration;
  /** Where the default lead model and reasoning level of a project come from. */
  agents: () => Pick<AgentConfigurationService, "captureDefaults">;
  stream?: typeof streamSimpleWithModel;
}): TextHost {
  const resolve = async (model: ModelSelection) => {
    const resolved = await input.models
      .resolve(model, structuredClone(input.configuration()))
      .catch(() => undefined);
    return resolved;
  };
  return {
    ready: async (model) => (await resolve(model)) !== undefined,
    async defaultModel(projectId) {
      const target = await projectDefaultModel(input.agents(), projectId);
      return target
        ? { ...target.selection, reasoningLevel: target.reasoningLevel }
        : undefined;
    },
    async complete(request) {
      const resolved = await resolve(request.model);
      if (!resolved)
        throw new ExtensionError(
          "DENIED",
          "No usable text model is selected.",
          {
            fix: "Ask the user to choose a model in the extension's settings (Settings → Extensions).",
          },
        );
      const reasoningLevel = thinkingLevelSchema.safeParse(
        request.model.reasoningLevel,
      );
      const level = reasoningLevel.success ? reasoningLevel.data : "off";
      const model = resolved.baseUrl
        ? { ...resolved.model, baseUrl: resolved.baseUrl }
        : resolved.model;
      const stream = (input.stream ?? streamSimpleWithModel)(
        model,
        {
          ...(request.system ? { systemPrompt: request.system } : {}),
          messages: [
            { role: "user", content: request.prompt, timestamp: Date.now() },
          ],
        },
        {
          apiKey: resolved.apiKey,
          headers: resolved.headers,
          env: resolved.env,
          ...(model.reasoning && level !== "off" ? { reasoning: level } : {}),
          ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
        },
      );
      for await (const event of stream) {
        if (event.type !== "thinking_delta" && event.type !== "text_delta")
          continue;
        try {
          request.onDelta?.({
            kind: event.type === "thinking_delta" ? "thinking" : "text",
            delta: event.delta,
          });
        } catch {
          // Live progress is best effort and never fails the call.
        }
      }
      const message = await stream.result();
      if (message.stopReason === "error" || message.stopReason === "aborted")
        throw new ExtensionError(
          "SERVER_ERROR",
          message.errorMessage ?? "The model call failed.",
        );
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!text)
        throw new ExtensionError("SERVER_ERROR", "The model returned no text.");
      return {
        text,
        model: `${request.model.provider}/${request.model.modelId}`,
      };
    },
  };
}

/** Nerve's default lead model and reasoning level for a project: what a new conversation there starts with. */
export async function projectDefaultModel(
  service: Pick<AgentConfigurationService, "captureDefaults">,
  projectId: string,
): Promise<Target | undefined> {
  const { settings } = resolveAgentConfiguration({
    ...(await service.captureDefaults(projectId)).options,
    role: "lead",
  });
  return settings.model && settings.reasoningLevel
    ? { selection: settings.model, reasoningLevel: settings.reasoningLevel }
    : undefined;
}
