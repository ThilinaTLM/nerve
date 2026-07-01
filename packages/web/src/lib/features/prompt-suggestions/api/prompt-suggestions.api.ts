import type {
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/shared";
import { protocolRequest } from "$lib/core/protocol/http-client";

export async function getPromptSuggestions(
  projectId: string,
  options: { conversationId?: string; agentId?: string } = {},
): Promise<PromptSuggestionListResponse> {
  return (
    await protocolRequest<PromptSuggestionListResponse>(
      "promptSuggestion.listForProject",
      { projectId, ...options },
    )
  ).result;
}

export async function getPromptSuggestionStatuses(
  projectId?: string,
): Promise<PromptSuggestionStatus[]> {
  return (
    await protocolRequest<{ statuses: PromptSuggestionStatus[] }>(
      "promptSuggestion.statuses.list",
      { projectId },
    )
  ).result.statuses;
}

export async function updatePromptSuggestionTrust(
  body: UpdatePromptSuggestionTrustRequest,
): Promise<void> {
  await protocolRequest<{ ok: true }>("promptSuggestion.trust.update", body);
}

export type {
  PromptSuggestion,
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/shared";
