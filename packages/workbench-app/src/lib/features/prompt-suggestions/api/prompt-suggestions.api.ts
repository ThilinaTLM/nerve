import type {
  CreatePromptSuggestionRequest,
  CreatePromptSuggestionResponse,
  PromptSuggestionListResponse,
  PromptSuggestionProjectFile,
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionProjectFileTrustRequest,
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

/** The suggestions with their state, and, for a project, its enablement file and whether it is trusted. */
export async function getPromptSuggestionStatuses(projectId?: string): Promise<{
  statuses: PromptSuggestionStatus[];
  projectFile?: PromptSuggestionProjectFile;
}> {
  return requestWorkbench("promptSuggestion.statuses.list", { projectId });
}

export async function trustPromptSuggestionProjectFile(
  body: UpdatePromptSuggestionProjectFileTrustRequest,
): Promise<"saved" | "conflict"> {
  return (await requestWorkbench("promptSuggestion.projectFile.trust", body))
    .status;
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

export type {
  CreatePromptSuggestionRequest,
  CreatePromptSuggestionResponse,
  PromptSuggestion,
  PromptSuggestionListResponse,
  PromptSuggestionProjectFile,
  PromptSuggestionSourceKind,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
  UpdatePromptSuggestionEnabledRequest,
} from "@nervekit/contracts/prompt-suggestions";
