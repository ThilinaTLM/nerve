import type { Context, Message, Model } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { AgentModelSelection } from "./model-contracts.js";
import {
  buildDevBenchScript,
  DEV_BENCH_DEFAULT_DIR,
  DEV_BENCH_FIRST_TOKEN_MS,
  DEV_BENCH_MODEL,
  DEV_BENCH_MODEL_NAME,
  DEV_BENCH_PROVIDER,
  DEV_BENCH_TOKEN_SIZE,
  DEV_BENCH_TOKENS_PER_SECOND,
  type DevBenchTurn,
} from "./dev-bench-script.js";
import {
  type ManagedFauxProviderHandle,
  registerManagedFauxProvider,
} from "./model-registry.js";

let registration: ManagedFauxProviderHandle | undefined;

function userText(message: Extract<Message, { role: "user" }>): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

/** The turn to answer next plus the scratch folder, derived from the transcript alone. */
export function resolveDevBenchTurn(messages: readonly Message[]): {
  index: number;
  dir: string;
} {
  let index = 0;
  let dir = DEV_BENCH_DEFAULT_DIR;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user") {
      dir = userText(message).match(/qa-sandbox-bench-[\w-]+/)?.[0] ?? dir;
      break;
    }
    if (message.role === "assistant") index += 1;
  }
  return { index, dir };
}

export function devBenchResponse(turn: DevBenchTurn, id: string) {
  return fauxAssistantMessage([
    fauxThinking(turn.thinking),
    fauxText(turn.text),
    ...(turn.tool
      ? [fauxToolCall(turn.tool.name, turn.tool.args as never, { id })]
      : []),
  ]);
}

/**
 * Registers the dev-only scripted bench model. Callers must have already
 * verified the dev gate (see workbench-server `devScriptedProviderEnabled`).
 */
export function registerDevScriptedBenchProvider(): void {
  if (registration) return;
  const handle = registerManagedFauxProvider({
    provider: DEV_BENCH_PROVIDER,
    models: [
      {
        id: DEV_BENCH_MODEL,
        name: DEV_BENCH_MODEL_NAME,
        reasoning: true,
        contextWindow: 200_000,
        maxTokens: 16_384,
      },
    ],
    tokensPerSecond: DEV_BENCH_TOKENS_PER_SECOND,
    tokenSize: { min: DEV_BENCH_TOKEN_SIZE, max: DEV_BENCH_TOKEN_SIZE },
  });
  registration = handle;
  // Stateless: every call re-queues itself and picks its turn from the transcript.
  const respond = async (
    context: Context,
    options?: { signal?: AbortSignal },
  ) => {
    handle.appendResponses([respond]);
    await new Promise<void>((resolve) => {
      if (options?.signal?.aborted) return resolve();
      const timer = setTimeout(resolve, DEV_BENCH_FIRST_TOKEN_MS);
      options?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    const { index, dir } = resolveDevBenchTurn(context.messages);
    const script = buildDevBenchScript(dir);
    const turn = script[Math.min(index, script.length - 1)];
    return devBenchResponse(turn, `scripted-${dir.slice(-12)}-${index}`);
  };
  handle.setResponses([respond]);
}

export function getDevScriptedBenchModel(
  selection: AgentModelSelection | undefined,
): Model<string> | undefined {
  if (!registration || selection?.provider !== DEV_BENCH_PROVIDER) {
    return undefined;
  }
  return registration.getModel(selection.modelId);
}

export function listDevScriptedBenchModels(): Model<string>[] {
  return registration ? [...registration.models] : [];
}
