import type {
  AgentRecord,
  ApprovalRecord,
  AudioTranscriptionResponse,
  AuthProviderMetadata,
  ClipboardImageUploadResponse,
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  ConversationTree,
  ConversationTreeNode,
  CreatePrResponse,
  EventEnvelope,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
  FilesystemSignal,
  GitBranchSuggestionResponse,
  GitCommitMessageResponse,
  GitCommitResponse,
  GitDiscoveryResponse,
  GitFileChange,
  GithubChecksSummary,
  GithubPr,
  GithubPrCheckoutResponse,
  GithubPrCommit,
  GithubPrDetail,
  GithubPrFile,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitPrSuggestionResponse,
  GitRepoSummary,
  ModelInfo,
  ModelSelection,
  PlanReviewRecord,
  ProcessLogEvent,
  ProcessLogQueryResponse,
  ProcessRecord,
  ProjectRecord,
  Settings,
  StatusResponse,
  SubscriptionUsage,
  SubscriptionWindow,
  ToolCallRecord,
  UpdateSettingsRequest,
  UserQuestionRecord,
} from "@nerve/shared";

export type ClientConfig = {
  url: string;
  wsUrl: string;
  status: StatusResponse;
};

export type CompletionItem = {
  label: string;
  detail?: string;
  info?: string;
  kind: "slash" | "file" | "directory";
  apply?: string;
};

export type WorkspaceSnapshot = {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  processes: ProcessRecord[];
};

export type SettingsResponse = Settings;
export type { UpdateSettingsRequest };
export type ModelOption = ModelInfo;

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallRecord;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(await response.text());
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new Error(
      `Expected JSON response from ${response.url || "API"}, received ${contentType || "unknown content type"}. ${body.slice(0, 80)}`,
    );
  }
  return (await response.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(path, { credentials: "same-origin" }));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(
        result.includes(",") ? result.slice(result.indexOf(",") + 1) : result,
      );
    };
    reader.readAsDataURL(file);
  });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function extensionForAudioType(type: string): string {
  const normalized = type.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "mp4";
    case "audio/mpeg":
    case "audio/mp3":
    case "audio/x-mpeg":
      return "mp3";
    case "audio/mpga":
      return "mpga";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/ogg":
    case "audio/oga":
      return "ogg";
    default:
      return "webm";
  }
}

type TranscribeAudioOptions = {
  signal?: AbortSignal;
};

function parseApiErrorBody(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; message?: unknown };
    };
    return {
      code:
        typeof parsed.error?.code === "string" ? parsed.error.code : undefined,
      message:
        typeof parsed.error?.message === "string"
          ? parsed.error.message
          : undefined,
    };
  } catch {
    return {};
  }
}

async function parseTranscriptionResponse(
  response: Response,
): Promise<AudioTranscriptionResponse> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const apiError = parseApiErrorBody(body);
    throw new ApiRequestError(
      response.status,
      apiError.code,
      apiError.message ||
        body ||
        response.statusText ||
        "Transcription failed.",
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new ApiRequestError(
      response.status,
      undefined,
      `Expected JSON response from transcription API, received ${contentType || "unknown content type"}. ${body.slice(0, 80)}`,
    );
  }
  return (await response.json()) as AudioTranscriptionResponse;
}

export async function transcribeAudio(
  audio: Blob,
  durationMs: number,
  options: TranscribeAudioOptions = {},
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    audio,
    `composer-recording.${extensionForAudioType(audio.type)}`,
  );
  form.append("durationMs", String(Math.max(1, Math.round(durationMs))));
  return (
    await parseTranscriptionResponse(
      await fetch("/api/transcription/audio", {
        method: "POST",
        credentials: "same-origin",
        body: form,
        signal: options.signal,
      }),
    )
  ).text;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function apiDelete<T>(path: string): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: "DELETE",
      credentials: "same-origin",
    }),
  );
}

export async function getClientConfig(): Promise<ClientConfig> {
  return apiGet<ClientConfig>("/api/client-config");
}

export async function getConversationSnapshot(
  conversationId: string,
): Promise<ConversationSnapshot> {
  return (
    await apiGet<{ snapshot: ConversationSnapshot }>(
      `/api/conversations/${conversationId}/snapshot`,
    )
  ).snapshot;
}

export async function getConversationContextUsage(
  conversationId: string,
): Promise<ContextUsage> {
  return (
    await apiGet<{ contextUsage: ContextUsage }>(
      `/api/conversations/${conversationId}/context-usage`,
    )
  ).contextUsage;
}

export async function getSettings(): Promise<Settings> {
  return apiGet<Settings>("/api/settings");
}

export async function updateSettings(
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  return (await apiPut<{ settings: Settings }>("/api/settings", patch))
    .settings;
}

export async function getModels(): Promise<ModelInfo[]> {
  return (await apiGet<{ models: ModelInfo[] }>("/api/models")).models;
}

export async function getSubscriptionUsage(): Promise<SubscriptionUsage[]> {
  return (
    await apiGet<{ usage: SubscriptionUsage[] }>("/api/usage/subscription")
  ).usage;
}

export async function updateAgentConfig(
  agentId: string,
  patch: {
    model?: ModelSelection | null;
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    thinkingLevel?: AgentRecord["thinkingLevel"];
  },
): Promise<AgentRecord> {
  return (
    await apiPatch<{ agent: AgentRecord }>(`/api/agents/${agentId}`, patch)
  ).agent;
}

export async function updateAgentModel(
  agentId: string,
  model: ModelSelection | undefined,
): Promise<AgentRecord> {
  return updateAgentConfig(agentId, { model: model ?? null });
}

export async function getAuthProviders(): Promise<AuthProviderMetadata[]> {
  return (
    await apiGet<{ providers: AuthProviderMetadata[] }>("/api/auth/providers")
  ).providers;
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [
    projectResponse,
    conversationResponse,
    agentResponse,
    processResponse,
  ] = await Promise.all([
    apiGet<{ projects: ProjectRecord[] }>("/api/projects"),
    apiGet<{ conversations: ConversationRecord[] }>("/api/conversations"),
    apiGet<{ agents: AgentRecord[] }>("/api/agents"),
    apiGet<{ processes: ProcessRecord[] }>("/api/processes"),
  ]);
  return {
    projects: projectResponse.projects,
    conversations: [...conversationResponse.conversations].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    agents: agentResponse.agents,
    processes: processResponse.processes,
  };
}

export async function getConversationEntries(
  conversationId: string,
): Promise<ConversationEntry[]> {
  return (
    await apiGet<{ entries: ConversationEntry[] }>(
      `/api/conversations/${conversationId}/entries`,
    )
  ).entries;
}

export async function getConversationTree(
  conversationId: string,
): Promise<ConversationTree> {
  return (
    await apiGet<{ tree: ConversationTree }>(
      `/api/conversations/${conversationId}/tree`,
    )
  ).tree;
}

export async function compactConversation(conversationId: string): Promise<{
  conversation: ConversationRecord;
  entry: ConversationEntry;
}> {
  return apiPost(`/api/conversations/${conversationId}/compact`, {});
}

async function apiDeleteNoContent(path: string): Promise<void> {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiDeleteNoContent(`/api/projects/${projectId}`);
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await apiDeleteNoContent(`/api/conversations/${conversationId}`);
}

export async function getSlashCompletions(): Promise<CompletionItem[]> {
  return (await apiGet<{ items: CompletionItem[] }>("/api/completions/slash"))
    .items;
}

export async function getProcessLogs(
  processId: string,
  mode = "recent",
): Promise<ProcessLogQueryResponse> {
  const params = new URLSearchParams({ mode, limit: "120" });
  return apiGet<ProcessLogQueryResponse>(
    `/api/processes/${processId}/logs?${params.toString()}`,
  );
}

export async function stopProcess(processId: string): Promise<ProcessRecord> {
  return (
    await apiPost<{ process: ProcessRecord }>(
      `/api/processes/${processId}/stop`,
      {},
    )
  ).process;
}

export async function restartProcess(
  processId: string,
): Promise<ProcessRecord> {
  return (
    await apiPost<{ process: ProcessRecord }>(
      `/api/processes/${processId}/restart`,
      {},
    )
  ).process;
}

export async function deleteProcess(processId: string): Promise<void> {
  await apiDelete<{ removed: boolean }>(`/api/processes/${processId}`);
}

export async function pruneProcesses(): Promise<{ removed: string[] }> {
  return apiPost<{ removed: string[] }>("/api/processes/prune", {});
}

export async function getToolCalls(): Promise<ToolCallRecord[]> {
  return (await apiGet<{ toolCalls: ToolCallRecord[] }>("/api/tool-calls"))
    .toolCalls;
}

export async function getPendingApprovals(): Promise<ApprovalWithToolCall[]> {
  const [{ approvals }, { toolCalls }] = await Promise.all([
    apiGet<{ approvals: ApprovalRecord[] }>("/api/approvals?status=pending"),
    apiGet<{ toolCalls: ToolCallRecord[] }>("/api/tool-calls"),
  ]);
  const byId = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall]));
  return approvals.map((approval) => ({
    ...approval,
    toolCall: byId.get(approval.toolCallId),
  }));
}

export async function getPendingUserQuestions(): Promise<UserQuestionRecord[]> {
  return (
    await apiGet<{ questions: UserQuestionRecord[] }>(
      "/api/user-questions?status=pending",
    )
  ).questions;
}

export async function getPendingPlanReviews(): Promise<PlanReviewRecord[]> {
  return (
    await apiGet<{ planReviews: PlanReviewRecord[] }>(
      "/api/plan-reviews?status=pending",
    )
  ).planReviews;
}

export async function acceptPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${reviewId}/accept`,
      { feedback },
    )
  ).planReview;
}

export async function rejectPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${reviewId}/reject`,
      { feedback },
    )
  ).planReview;
}

export async function requestPlanChanges(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${reviewId}/request-changes`,
      { feedback },
    )
  ).planReview;
}

export async function discardPlanReview(
  reviewId: string,
  feedback?: string,
): Promise<PlanReviewRecord> {
  return (
    await apiPost<{ planReview: PlanReviewRecord }>(
      `/api/plan-reviews/${reviewId}/discard`,
      { feedback },
    )
  ).planReview;
}

export async function answerUserQuestion(
  questionId: string,
  answer: string,
): Promise<UserQuestionRecord> {
  return (
    await apiPost<{ question: UserQuestionRecord }>(
      `/api/user-questions/${questionId}/answer`,
      { answer },
    )
  ).question;
}

export async function dismissUserQuestion(
  questionId: string,
  reason?: string,
): Promise<UserQuestionRecord> {
  return (
    await apiPost<{ question: UserQuestionRecord }>(
      `/api/user-questions/${questionId}/dismiss`,
      { reason },
    )
  ).question;
}

export async function getFileCompletions(
  projectId: string | undefined,
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  const params = new URLSearchParams({ projectId, q: query });
  return (
    await apiGet<{ items: CompletionItem[] }>(
      `/api/completions/files?${params.toString()}`,
    )
  ).items;
}

export async function discoverGitRepos(
  projectId: string,
): Promise<GitDiscoveryResponse> {
  return apiGet<GitDiscoveryResponse>(`/api/projects/${projectId}/git/repos`);
}

export async function getGitOverview(
  projectId: string,
  repo: string,
): Promise<GitOverviewResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GitOverviewResponse>(
    `/api/projects/${projectId}/git/overview?${params.toString()}`,
  );
}

export async function createGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/branch`, {
    repo,
    name,
  });
}

export async function commitGitChanges(
  projectId: string,
  repo: string,
  body: { subject: string; body?: string; all: boolean },
): Promise<GitCommitResponse> {
  return apiPost<GitCommitResponse>(`/api/projects/${projectId}/git/commit`, {
    repo,
    ...body,
  });
}

export async function syncGitBase(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(
    `/api/projects/${projectId}/git/sync-base`,
    { repo },
  );
}

export async function pushGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/push`, {
    repo,
  });
}

export async function pullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/pull`, {
    repo,
  });
}

export async function fetchGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/fetch`, {
    repo,
  });
}

export async function suggestGitBranchName(
  projectId: string,
  repo: string,
  agentId?: string,
): Promise<GitBranchSuggestionResponse> {
  const params = new URLSearchParams({ repo });
  if (agentId) params.set("agentId", agentId);
  return apiGet<GitBranchSuggestionResponse>(
    `/api/projects/${projectId}/git/suggest/branch?${params.toString()}`,
  );
}

export async function suggestGitCommitMessage(
  projectId: string,
  repo: string,
  agentId?: string,
): Promise<GitCommitMessageResponse> {
  const params = new URLSearchParams({ repo });
  if (agentId) params.set("agentId", agentId);
  return apiGet<GitCommitMessageResponse>(
    `/api/projects/${projectId}/git/suggest/commit?${params.toString()}`,
  );
}

export async function suggestGitPr(
  projectId: string,
  repo: string,
  agentId?: string,
): Promise<GitPrSuggestionResponse> {
  const params = new URLSearchParams({ repo });
  if (agentId) params.set("agentId", agentId);
  return apiGet<GitPrSuggestionResponse>(
    `/api/projects/${projectId}/git/suggest/pr?${params.toString()}`,
  );
}

export async function getGithubStatus(
  projectId: string,
  repo: string,
): Promise<GithubStatusResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GithubStatusResponse>(
    `/api/projects/${projectId}/github/status?${params.toString()}`,
  );
}

export async function listMyGithubPrs(
  projectId: string,
  repo: string,
): Promise<GithubPrListResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GithubPrListResponse>(
    `/api/projects/${projectId}/github/prs?${params.toString()}`,
  );
}

export async function createGithubPr(
  projectId: string,
  repo: string,
  body: { title: string; body?: string; base?: string; draft: boolean },
): Promise<CreatePrResponse> {
  return apiPost<CreatePrResponse>(`/api/projects/${projectId}/github/pr`, {
    repo,
    ...body,
  });
}

export async function getGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrDetail> {
  const params = new URLSearchParams({ repo });
  return apiGet<GithubPrDetail>(
    `/api/projects/${projectId}/github/pr/${number}?${params.toString()}`,
  );
}

export async function checkoutGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  return apiPost<GithubPrCheckoutResponse>(
    `/api/projects/${projectId}/github/pr/${number}/checkout`,
    { repo },
  );
}

export async function uploadClipboardImage(file: File): Promise<string> {
  const response = await apiPost<ClipboardImageUploadResponse>(
    "/api/filesystem/clipboard-image",
    {
      name: file.name,
      type: file.type,
      dataBase64: await fileToBase64(file),
    },
  );
  return response.path;
}

export async function listDirectories(
  path?: string,
  showHidden = false,
): Promise<FilesystemDirectoryResponse> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (showHidden) params.set("showHidden", "true");
  const suffix = params.toString();
  return apiGet<FilesystemDirectoryResponse>(
    `/api/filesystem/directories${suffix ? `?${suffix}` : ""}`,
  );
}

export async function getFileContent(
  projectId: string,
  path: string,
  line?: number,
): Promise<FilesystemFileResponse> {
  const params = new URLSearchParams({ projectId, path });
  if (line !== undefined) params.set("line", String(line));
  return apiGet<FilesystemFileResponse>(
    `/api/filesystem/file?${params.toString()}`,
  );
}

export type {
  AgentRecord,
  ClipboardImageUploadResponse,
  ConversationActiveRunSnapshot,
  ConversationSnapshot,
  EventEnvelope,
  FilesystemDirectoryResponse,
  FilesystemFileResponse,
  FilesystemSignal,
  ProjectRecord,
  ConversationEntry,
  ConversationRecord,
  ConversationTree,
  ConversationTreeNode,
  StatusResponse,
  ApprovalRecord,
  ToolCallRecord,
  UserQuestionRecord,
  PlanReviewRecord,
  ProcessRecord,
  ProcessLogEvent,
  ProcessLogQueryResponse,
  Settings,
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  ContextUsage,
  SubscriptionUsage,
  SubscriptionWindow,
  GitRepoSummary,
  GitDiscoveryResponse,
  GitOverviewResponse,
  GitFileChange,
  GitBranchSuggestionResponse,
  GitCommitMessageResponse,
  GitCommitResponse,
  GitPrSuggestionResponse,
  GitMutationResponse,
  GithubStatusResponse,
  GithubPr,
  GithubPrListResponse,
  GithubChecksSummary,
  GithubPrDetail,
  GithubPrFile,
  GithubPrCommit,
  GithubPrCheckoutResponse,
  CreatePrResponse,
};
