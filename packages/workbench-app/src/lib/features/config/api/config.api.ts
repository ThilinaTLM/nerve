import { protocolRequest as conversationRequest } from "@nervekit/protocol/adapters";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { ModelInfo } from "@nervekit/contracts/models";
import type { StatusResponse } from "@nervekit/contracts/status";
import { apiGet } from "$lib/platform/http/api-client";

export type ClientConfig = {
  url: string;
  wsUrl: string;
  status: StatusResponse;
};

export type { CompletionItem } from "@nervekit/contracts/completions";

export type ModelOption = ModelInfo;

export async function getClientConfig(): Promise<ClientConfig> {
  return apiGet<ClientConfig>("/api/client-config");
}

export async function getModels(): Promise<ModelInfo[]> {
  return (await conversationRequest("model.list", {})).result.models;
}

export async function getSlashCompletions(): Promise<CompletionItem[]> {
  return (await conversationRequest("completion.slash.list", {})).result.items;
}
