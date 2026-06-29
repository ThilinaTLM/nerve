import type {
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/shared";
import { apiGet, apiPathSegment, apiPost } from "$lib/core/api/client";

export async function getPromptSuggestions(
  projectId: string,
  options: { conversationId?: string; agentId?: string } = {},
): Promise<PromptSuggestionListResponse> {
  const params = new URLSearchParams();
  if (options.conversationId)
    params.set("conversationId", options.conversationId);
  if (options.agentId) params.set("agentId", options.agentId);
  const query = params.toString();
  return apiGet<PromptSuggestionListResponse>(
    `/api/projects/${apiPathSegment(projectId)}/prompt-suggestions${query ? `?${query}` : ""}`,
  );
}

export async function getPromptSuggestionStatuses(
  projectId?: string,
): Promise<PromptSuggestionStatus[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const query = params.toString();
  return (
    await apiGet<{ statuses: PromptSuggestionStatus[] }>(
      `/api/prompt-suggestions/statuses${query ? `?${query}` : ""}`,
    )
  ).statuses;
}

export async function updatePromptSuggestionTrust(
  body: UpdatePromptSuggestionTrustRequest,
): Promise<void> {
  await apiPost<{ ok: true }>("/api/prompt-suggestions/trust", body);
}

export type {
  PromptSuggestion,
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/shared";
