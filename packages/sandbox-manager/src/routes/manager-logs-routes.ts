import {
  applicationLogLevelSchema,
  type ManagerLogTailResponse,
} from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";

/**
 * Reads the manager's in-memory structured-log ring buffer for the
 * `GET /api/manager/logs` tail endpoint. Poll with `sinceSeq=nextCursor`.
 * Query params: `level` (minimum level), `contains`, `sinceSeq`, `limit`.
 */
export function tailManagerLogs(
  state: ManagerState,
  params: URLSearchParams,
): ManagerLogTailResponse {
  const level = applicationLogLevelSchema.safeParse(
    params.get("level") ?? undefined,
  ).data;
  const limitRaw = Number(params.get("limit") ?? 200);
  const sinceRaw = Number(params.get("sinceSeq") ?? 0);
  return state.logBuffer.query({
    level,
    contains: params.get("contains")?.trim() || undefined,
    limit: Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, Math.floor(limitRaw)), 1000)
      : 200,
    sinceSeq: Number.isFinite(sinceRaw) ? Math.max(0, Math.floor(sinceRaw)) : 0,
  });
}
