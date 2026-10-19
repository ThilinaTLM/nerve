import { RpcError } from "@nervekit/protocol/rpc";

/**
 * Whether a rejected merge/checkout request still needs a client Activity notice.
 *
 * The server annotates `RpcError.data.details.activityId` only when its mutation
 * publisher actually recorded a failure Activity. Any other rejection (local
 * transport/preparation failures, timeouts, or server errors raised before the
 * mutation ran) has no Activity and must be reported by the client.
 */
export function needsClientFailureNotice(error: unknown): boolean {
  if (!(error instanceof RpcError)) return true;
  const activityId = error.data.details?.activityId;
  return !(typeof activityId === "string" && activityId.length > 0);
}
