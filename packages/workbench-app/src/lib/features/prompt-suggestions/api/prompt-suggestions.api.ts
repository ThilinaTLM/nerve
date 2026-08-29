import type {
  CreatePromptSuggestionRequest,
  CreatePromptSuggestionResponse,
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/contracts/prompt-suggestions";
import { protocolRequest } from "@nervekit/protocol";

export async function getPromptSuggestions(
  projectId: string,
  options: { conversationId?: string; agentId?: string } = {},
): Promise<PromptSuggestionListResponse> {
  return (
    await protocolRequest("promptSuggestion.listForProject", {
      projectId,
      ...options,
    })
  ).result;
}

export async function getPromptSuggestionStatuses(
  projectId?: string,
): Promise<PromptSuggestionStatus[]> {
  return (
    await protocolRequest("promptSuggestion.statuses.list", { projectId })
  ).result.statuses;
}

export async function requestPromptSuggestionCreation(
  body: CreatePromptSuggestionRequest,
): Promise<CreatePromptSuggestionResponse> {
  return (await protocolRequest("promptSuggestion.create", body)).result;
}

export async function updatePromptSuggestionEnabled(
  body: UpdatePromptSuggestionEnabledRequest,
): Promise<void> {
  await protocolRequest("promptSuggestion.enabled.update", body);
}

export async function updatePromptSuggestionTrust(
  body: UpdatePromptSuggestionTrustRequest,
): Promise<void> {
  await protocolRequest("promptSuggestion.trust.update", body);
}

export type {
  CreatePromptSuggestionRequest,
  CreatePromptSuggestionResponse,
  PromptSuggestion,
  PromptSuggestionListResponse,
  PromptSuggestionSourceKind,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/contracts/prompt-suggestions";
