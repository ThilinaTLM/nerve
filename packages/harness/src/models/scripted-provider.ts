import type { Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  type ManagedFauxProviderHandle,
  registerManagedFauxProvider,
} from "./provider-registry.js";
import type {
  AgentModelSelection,
  AgentScriptedProviderStep,
} from "./types.js";

const scriptedProviders = new Map<string, ManagedFauxProviderHandle>();

export function registerAgentScriptedProvider(options: {
  provider?: string;
  model?: string;
  steps: AgentScriptedProviderStep[];
}): ManagedFauxProviderHandle {
  const provider = options.provider ?? "nerve-scripted";
  const model = options.model ?? "scripted-fast";
  const registration = registerManagedFauxProvider({
    provider,
    models: [{ id: model, name: "Nerve Scripted Test Model" }],
    tokensPerSecond: 10_000,
    tokenSize: { min: 64, max: 256 },
  });
  registration.setResponses(
    options.steps.map((step) => async (_context, streamOptions) => {
      if (step.type === "assistantText") {
        return fauxAssistantMessage(step.text ?? step.chunks?.join("") ?? "");
      }
      if (step.type === "toolCall") {
        return fauxAssistantMessage([
          fauxToolCall(step.name, step.args as never, { id: step.id }),
        ]);
      }
      if (step.type === "toolCalls") {
        return fauxAssistantMessage(
          step.calls.map((call) =>
            fauxToolCall(call.name, call.args as never, { id: call.id }),
          ),
        );
      }
      if (step.type === "waitForAbort") {
        await new Promise<void>((resolve) => {
          if (streamOptions?.signal?.aborted) return resolve();
          streamOptions?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return fauxAssistantMessage("aborted");
      }
      return fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: `${step.retryable === false ? "NON_RETRYABLE" : "RETRYABLE"}: ${step.message}`,
      });
    }),
  );
  scriptedProviders.set(provider, registration);
  const unregister = registration.unregister;
  return {
    ...registration,
    unregister: () => {
      scriptedProviders.delete(provider);
      unregister();
    },
  };
}

export function getScriptedProviderModel(
  selection: AgentModelSelection | undefined,
): Model<string> | undefined {
  if (!selection) return undefined;
  return scriptedProviders.get(selection.provider)?.getModel(selection.modelId);
}
