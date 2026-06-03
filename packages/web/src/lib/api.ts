import type {
  AgentRecord,
  ApprovalRecord,
  AuthProviderMetadata,
  EventEnvelope,
  FilesystemDirectoryResponse,
  FilesystemSignal,
  ModelInfo,
  ModelSelection,
  ProcessLogQueryResponse,
  ProcessRecord,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
  SessionTree,
  SessionTreeNode,
  Settings,
  StatusResponse,
  ToolCallRecord,
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
  sessions: SessionRecord[];
  agents: AgentRecord[];
  processes: ProcessRecord[];
};

export type SettingsResponse = Settings;
export type ModelOption = ModelInfo;

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallRecord;
};

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

export async function getSettings(): Promise<Settings> {
  return apiGet<Settings>("/api/settings");
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  return (await apiPut<{ settings: Settings }>("/api/settings", patch))
    .settings;
}

export async function getModels(): Promise<ModelInfo[]> {
  return (await apiGet<{ models: ModelInfo[] }>("/api/models")).models;
}

export async function updateAgentConfig(
  agentId: string,
  patch: {
    model?: ModelSelection | null;
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
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
  const [projectResponse, sessionResponse, agentResponse, processResponse] =
    await Promise.all([
      apiGet<{ projects: ProjectRecord[] }>("/api/projects"),
      apiGet<{ sessions: SessionRecord[] }>("/api/sessions"),
      apiGet<{ agents: AgentRecord[] }>("/api/agents"),
      apiGet<{ processes: ProcessRecord[] }>("/api/processes"),
    ]);
  return {
    projects: projectResponse.projects,
    sessions: [...sessionResponse.sessions].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    agents: agentResponse.agents,
    processes: processResponse.processes,
  };
}

export async function getSessionMessages(
  sessionId: string,
): Promise<SessionEntry[]> {
  return (
    await apiGet<{ entries: SessionEntry[] }>(
      `/api/sessions/${sessionId}/messages`,
    )
  ).entries;
}

export async function getSessionTree(sessionId: string): Promise<SessionTree> {
  return (
    await apiGet<{ tree: SessionTree }>(`/api/sessions/${sessionId}/tree`)
  ).tree;
}

export async function compactSession(sessionId: string): Promise<{
  session: SessionRecord;
  entry: SessionEntry;
}> {
  return apiPost(`/api/sessions/${sessionId}/compact`, {});
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

export async function deleteSession(sessionId: string): Promise<void> {
  await apiDeleteNoContent(`/api/sessions/${sessionId}`);
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

export type {
  AgentRecord,
  EventEnvelope,
  FilesystemDirectoryResponse,
  FilesystemSignal,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
  SessionTree,
  SessionTreeNode,
  StatusResponse,
  ApprovalRecord,
  ToolCallRecord,
  ProcessRecord,
  ProcessLogQueryResponse,
  Settings,
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
};
