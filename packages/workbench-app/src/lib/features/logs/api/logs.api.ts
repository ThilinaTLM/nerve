import type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogPruneResponse,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
} from "@nervekit/contracts";
import { apiGet } from "@nervekit/ui-kit/core/api/client";
import { protocolRequest } from "@nervekit/protocol";

export type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogPruneResponse,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
};

export async function getApplicationLogs(
  query: {
    level?: ApplicationLogLevel;
    source?: ApplicationLogSource;
    component?: string;
    contains?: string;
    sinceSeq?: number;
    limit?: number;
  } = {},
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
  return (
    await protocolRequest<ApplicationLogPruneResponse>(
      "applicationLog.prune",
      request,
    )
  ).result;
}
