import type { ProtocolMethodName, SnapshotCursor } from "@nervekit/contracts";
import {
  ProtocolRequestError,
  type ProtocolRequestOptions,
  protocolRequest as sharedProtocolRequest,
} from "@nervekit/workbench-ui/core/protocol/http-client";

export { ProtocolRequestError };

export function protocolRequest<T>(
  method: ProtocolMethodName,
  params?: unknown,
  options: Pick<ProtocolRequestOptions, "idempotencyKey" | "timeoutMs"> = {},
): Promise<{ result: T; cursor?: SnapshotCursor }> {
  return sharedProtocolRequest<T>(method, params, {
    ...options,
    apiPath: "/api/protocol/v1",
    sourceName: "Nerve Web UI",
  });
}
