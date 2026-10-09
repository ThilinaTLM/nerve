import type {
  CreatePromptSuggestionRequest,
  CreatePromptSuggestionResponse,
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/contracts/prompt-suggestions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export async function getPromptSuggestions(
  projectId: string,
  options: { conversationId?: string } = {},
): Promise<PromptSuggestionListResponse> {
  return requestWorkbench("promptSuggestion.listForProject", {
    projectId,
    ...options,
  });
}

export async function getPromptSuggestionStatuses(
  projectId?: string,
): Promise<PromptSuggestionStatus[]> {
  return (
    await requestWorkbench("promptSuggestion.statuses.list", { projectId })
  ).statuses;
}

export async function requestPromptSuggestionCreation(
  body: CreatePromptSuggestionRequest,
): Promise<CreatePromptSuggestionResponse> {
  return requestWorkbench("promptSuggestion.create", body);
}

export async function updatePromptSuggestionEnabled(
  body: UpdatePromptSuggestionEnabledRequest,
): Promise<void> {
  await requestWorkbench("promptSuggestion.enabled.update", body);
}

export async function updatePromptSuggestionTrust(
  body: UpdatePromptSuggestionTrustRequest,
): Promise<void> {
  await requestWorkbench("promptSuggestion.trust.update", body);
}

export type {
  CreatePromptSuggestionRequest,
  CreatePromptSuggestionResponse,
  PromptSuggestion,
  PromptSuggestionDiagnostic,
  PromptSuggestionListResponse,
  PromptSuggestionSourceKind,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/contracts/prompt-suggestions";
