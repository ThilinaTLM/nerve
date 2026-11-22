import {
  modelSelectionSchema,
  thinkingLevelSchema,
  type ModelSelection,
  type ThinkingLevel,
} from "@nervekit/contracts/models";
import { ExtensionError } from "@nervekit/extension-api";
import { streamSimpleWithModel } from "@nervekit/harness/models";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { createVisionHost } from "./vision-models.js";
import type { ModelConfiguration } from "./model.adapter.js";

type Resolve = (
  selection: ModelSelection,
  configuration: ModelConfiguration,
) => Promise<{
  model: Parameters<typeof streamSimpleWithModel>[0];
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}>;

/** What a request runs on: the selection and its reasoning level. */
type Target = { selection: ModelSelection; reasoningLevel: ThinkingLevel };

/**
 * The host side of `ctx.models.text`: one direct model call without tools. The model
 * and reasoning level come from the extension's `model` setting (`selection`, its
 * value) or, when the setting is absent, from Nerve's default for the project.
 */
export type TextHost = {
  /** Whether the model resolves with credentials. */
  ready(input: { selection?: unknown; projectId?: string }): Promise<boolean>;
  complete(input: {
    selection?: unknown;
    projectId?: string;
    system?: string;
    prompt: string;
    maxTokens?: number;
    onDelta?: (update: { kind: "thinking" | "text"; delta: string }) => void;
    signal?: AbortSignal;
  }): Promise<{ text: string; model: string }>;
};

export function createTextHost(input: {
  models: { resolve: Resolve };
  configuration: () => ModelConfiguration;
  /** Where the default lead model and reasoning level of a project come from. */
  agents: () => Pick<AgentConfigurationService, "captureDefaults">;
  stream?: typeof streamSimpleWithModel;
}): TextHost {
  const target = async (
    selection: unknown,
    projectId: string | undefined,
  ): Promise<Target | undefined> => {
    if (selection === undefined)
      return projectId
        ? await projectDefaultModel(input.agents(), projectId)
        : undefined;
    const parsed = modelSelectionSchema.safeParse(selection);
    if (!parsed.success) return undefined;
    const level = thinkingLevelSchema.safeParse(
      (selection as { reasoningLevel?: unknown }).reasoningLevel,
    );
    return {
      selection: parsed.data,
      reasoningLevel: level.success ? level.data : "off",
    };
  };
  const resolve = async (selection: unknown, projectId: string | undefined) => {
    const chosen = await target(selection, projectId);
    if (!chosen) return undefined;
    const resolved = await input.models
      .resolve(chosen.selection, structuredClone(input.configuration()))
      .catch(() => undefined);
    if (!resolved) return undefined;
    return { ...chosen, resolved };
  };
  return {
    ready: async (request) =>
      (await resolve(request.selection, request.projectId)) !== undefined,
    async complete(request) {
      const chosen = await resolve(request.selection, request.projectId);
      if (!chosen)
        throw new ExtensionError(
          "DENIED",
          "No usable text model is selected.",
          {
            fix:
              request.selection === undefined
                ? "Ask the user to choose a default model in Nerve's settings."
                : "Ask the user to choose a model in the extension's settings (Settings → Extensions).",
          },
        );
      const { resolved } = chosen;
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
          ...(model.reasoning && chosen.reasoningLevel !== "off"
            ? { reasoning: chosen.reasoningLevel }
            : {}),
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
        model: `${chosen.selection.provider}/${chosen.selection.modelId}`,
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

/** The model hosts behind `ctx.models.vision` and `ctx.models.text`. */
export function createModelHosts(input: {
  models: { resolve: Resolve };
  configuration: () => ModelConfiguration;
  agents: () => Pick<AgentConfigurationService, "captureDefaults">;
}) {
  return {
    vision: createVisionHost({
      resolve: async (selection, configuration) =>
        await input.models.resolve(selection, configuration),
      configuration: input.configuration,
    }),
    text: createTextHost(input),
  };
}
