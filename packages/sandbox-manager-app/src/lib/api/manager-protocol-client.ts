import type { OperationName, SnapshotCursor } from "@nervekit/contracts";
import {
  ProtocolRequestError,
  type ProtocolRequestOptions,
  protocolRequest as sharedProtocolRequest,
} from "@nervekit/protocol";

export { ProtocolRequestError };

export function sandboxProtocolRequest<T>(
  sandboxId: string,
  method: OperationName,
  params?: unknown,
  options: Pick<ProtocolRequestOptions, "idempotencyKey" | "timeoutMs"> = {},
): Promise<{ result: T; cursor?: SnapshotCursor }> {
  return protocolRequest<T>(method, params, {
    ...options,
    target: { role: "sandbox_agent", id: sandboxId },
  });
}

export function protocolRequest<T>(
  method: OperationName,
  params?: unknown,
  options: Pick<
    ProtocolRequestOptions,
    "idempotencyKey" | "timeoutMs" | "target"
  > = {},
): Promise<{ result: T; cursor?: SnapshotCursor }> {
  return sharedProtocolRequest<T>(method, params, {
    ...options,
    apiPath: "/api/protocol/v1",
    sourceName: "Nerve Sandbox Manager UI",
    target: options.target ?? { role: "sandbox_manager" },
  });
}
