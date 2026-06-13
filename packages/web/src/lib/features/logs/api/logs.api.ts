import type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogPruneResponse,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
} from "@nerve/shared";
import { apiGet, apiPost } from "../../../shared/api/client";

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
  return apiPost<ApplicationLogPruneResponse>("/api/logs/prune", request);
}
