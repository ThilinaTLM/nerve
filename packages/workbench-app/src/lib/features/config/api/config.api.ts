import type { StatusResponse } from "@nervekit/contracts/status";
import { apiGet } from "$lib/platform/http/api-client";

export type ClientConfig = {
  url: string;
  wsUrl: string;
  status: StatusResponse;
};

export async function getClientConfig(): Promise<ClientConfig> {
  return apiGet<ClientConfig>("/api/client-config");
}
