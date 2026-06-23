import type { CompletionItem, ModelInfo, StatusResponse } from "@nerve/shared";
import { apiGet } from "../../../core/api/client";

export type ClientConfig = {
  url: string;
  wsUrl: string;
  status: StatusResponse;
};

export type { CompletionItem } from "@nerve/shared";

export type ModelOption = ModelInfo;

export async function getClientConfig(): Promise<ClientConfig> {
  return apiGet<ClientConfig>("/api/client-config");
}

export async function getModels(): Promise<ModelInfo[]> {
  return (await apiGet<{ models: ModelInfo[] }>("/api/models")).models;
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
