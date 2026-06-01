import type {
  AgentRecord,
  EventEnvelope,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
  SessionTree,
  SessionTreeNode,
  StatusResponse,
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
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
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

export async function getClientConfig(): Promise<ClientConfig> {
  return apiGet<ClientConfig>("/api/client-config");
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [projectResponse, sessionResponse, agentResponse] = await Promise.all([
    apiGet<{ projects: ProjectRecord[] }>("/api/projects"),
    apiGet<{ sessions: SessionRecord[] }>("/api/sessions"),
    apiGet<{ agents: AgentRecord[] }>("/api/agents"),
  ]);
  return {
    projects: projectResponse.projects,
    sessions: [...sessionResponse.sessions].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    agents: agentResponse.agents,
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

export async function getSlashCompletions(): Promise<CompletionItem[]> {
  return (await apiGet<{ items: CompletionItem[] }>("/api/completions/slash"))
    .items;
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

export type {
  AgentRecord,
  EventEnvelope,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
  SessionTree,
  SessionTreeNode,
  StatusResponse,
};
