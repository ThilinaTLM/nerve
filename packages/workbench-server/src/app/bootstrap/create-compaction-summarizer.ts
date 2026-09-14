import { generateSummary } from "@nervekit/harness/compaction";
import { resolveAgentModel } from "@nervekit/harness/models";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { RuntimeState } from "../runtime/runtime-projections.js";
import type { AuthManager } from "../../domains/auth/index.js";
import type { ProviderCatalogStore } from "../../domains/providers/provider-catalog.store.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { CompactionSummarizer } from "../../domains/conversations/operations/index.js";

export function createCompactionSummarizer(input: {
  getConversation(conversationId: string): ConversationRecord;
  state: RuntimeState;
  providerCatalog: ProviderCatalogStore;
  secrets: SecretProvider;
  auth: AuthManager;
}): CompactionSummarizer {
  return async ({
    conversationId,
    agentId,
    messages,
    previousSummary,
    instructions,
    summaryProfile,
    summaryReserveTokens,
    signal,
    onProgress,
  }) => {
    const conversation = input.getConversation(conversationId);
    const resolvedAgentId = agentId ?? conversation.activeAgentId;
    const agent = resolvedAgentId
      ? input.state.agents.get(resolvedAgentId)
      : undefined;
    if (!agent) return undefined;
    const model = resolveAgentModel(
      agent.model,
      await input.providerCatalog.resolvedModelsWithCredentials(
        (name) => input.secrets.get(name),
        agent.projectDir,
      ),
    );
    if (model.provider === "nerve-faux") return undefined;
    const requestAuth = await input.auth.requestAuthForPiModel(model);
    if (!requestAuth) return undefined;
    const requestModel = requestAuth.baseUrl
      ? { ...model, baseUrl: requestAuth.baseUrl }
      : model;
    const result = await generateSummary({
      messages,
      model: requestModel,
      reserveTokens: summaryReserveTokens,
      apiKey: requestAuth.apiKey ?? "",
      headers: requestAuth.headers,
      signal,
      customInstructions: instructions,
      previousSummary,
      summaryProfile,
      thinkingLevel: agent.thinkingLevel,
      env: requestAuth.env,
      onProgress,
    });
    return result.ok
      ? { text: result.value, generatedBy: "model" as const }
      : undefined;
  };
}
