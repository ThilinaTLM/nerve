import type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogPruneResponse,
  ApplicationLogQuery,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
} from "@nervekit/contracts/logs";
import { apiGet } from "$lib/platform/http/api-client";
import { protocolRequest } from "@nervekit/protocol/adapters";

export type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogPruneResponse,
  ApplicationLogQuery,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
};

export async function getApplicationLogs(
  query: ApplicationLogQuery = {},
): Promise<ApplicationLogQueryResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && String(value).length > 0) {
      params.set(key, String(value));
    }
  }
  return apiGet<ApplicationLogQueryResponse>(
    `/api/logs${params.size ? `?${params.toString()}` : ""}`,
  );
}

export async function pruneApplicationLogs(
  request: ApplicationLogPruneRequest,
): Promise<ApplicationLogPruneResponse> {
  return (await protocolRequest("applicationLog.prune", request)).result;
}
