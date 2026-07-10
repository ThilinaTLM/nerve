import type {
  CompletionItem,
  ModelInfo,
  StatusResponse,
} from "@nervekit/contracts";
import { apiGet } from "@nervekit/workbench-ui/core/api/client";
import { protocolRequest } from "../../../core/protocol/http-client";

export type ClientConfig = {
  url: string;
  wsUrl: string;
  status: StatusResponse;
};

export type { CompletionItem } from "@nervekit/contracts";

export type ModelOption = ModelInfo;

export async function getClientConfig(): Promise<ClientConfig> {
  return apiGet<ClientConfig>("/api/client-config");
}

export async function getModels(): Promise<ModelInfo[]> {
  return (await protocolRequest<{ models: ModelInfo[] }>("model.list", {}))
    .result.models;
}

export async function getSlashCompletions(): Promise<CompletionItem[]> {
  return (
    await protocolRequest<{ items: CompletionItem[] }>(
      "completion.slash.list",
      {},
    )
  ).result.items;
}

export async function getFileCompletions(
  projectId: string | undefined,
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  return (
    await protocolRequest<{ items: CompletionItem[] }>(
      "completion.files.list",
      { projectId, q: query },
    )
  ).result.items;
}
