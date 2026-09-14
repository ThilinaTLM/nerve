import { generateSummary } from "@nervekit/harness/compaction";
import { resolveAgentModel } from "@nervekit/harness/models";
import type { AgentMessage } from "@nervekit/harness/agent";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { CanonicalConversationEntry } from "@nervekit/contracts/conversations";
import type { AuthManager } from "../../auth/index.js";
import type { ProviderCatalogStore } from "../../providers/provider-catalog.store.js";
import type { SecretProvider } from "../../../infrastructure/secrets/index.js";

/** Prepares model-generated summaries exclusively from immutable canonical input. */
export class CanonicalCompactionSummaryPreparer {
  constructor(
    private readonly deps: {
      providerCatalog: ProviderCatalogStore;
      secrets: SecretProvider;
      auth: AuthManager;
    },
  ) {}

  async prepare(input: {
    agent: AgentRecord;
    entriesDescending: readonly CanonicalConversationEntry[];
    summaryReserveTokens: number;
    signal?: AbortSignal;
    instructions?: string;
  }): Promise<string> {
    const model = resolveAgentModel(
      input.agent.model,
      await this.deps.providerCatalog.resolvedModelsWithCredentials(
        (name) => this.deps.secrets.get(name),
        input.agent.projectDir,
      ),
    );
    const messages = [...input.entriesDescending]
      .reverse()
      .map(toMessage)
      .filter((message): message is AgentMessage => Boolean(message));
    const requestAuth = await this.deps.auth.requestAuthForPiModel(model);
    if (model.provider !== "nerve-faux" && requestAuth) {
      const result = await generateSummary({
        messages,
        model: requestAuth.baseUrl
          ? { ...model, baseUrl: requestAuth.baseUrl }
          : model,
        reserveTokens: input.summaryReserveTokens,
        apiKey: requestAuth.apiKey ?? "",
        headers: requestAuth.headers,
        signal: input.signal,
        thinkingLevel: input.agent.thinkingLevel,
        env: requestAuth.env,
        customInstructions: input.instructions,
      });
      if (result.ok && result.value.trim()) return result.value.trim();
    }
    return [
      input.instructions ?? "",
      ...messages.map((message) => {
        const text = messageText(message);
        return text ? `${message.role}: ${text}` : "";
      }),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(-64_000);
  }
}

function messageText(message: AgentMessage): string {
  const content = "content" in message ? message.content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } =>
        Boolean(
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string",
        ),
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

function toMessage(
  entry: CanonicalConversationEntry,
): AgentMessage | undefined {
  const inline = entry.inlineContent as Record<string, unknown>;
  const exact = inline.exactHarnessMessage;
  if (exact && typeof exact === "object" && "role" in exact) {
    return exact as AgentMessage;
  }
  if (typeof inline.text !== "string" || !inline.text) return undefined;
  return {
    role: "harness",
    eventType: "canonical_summary_source",
    content: inline.text,
    timestamp:
      typeof entry.provenance.createdAt === "string"
        ? Date.parse(entry.provenance.createdAt)
        : Date.now(),
  };
}
