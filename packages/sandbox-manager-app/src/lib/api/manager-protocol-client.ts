import type {
  OperationName,
  OperationParams,
  OperationResult,
  SnapshotCursor,
} from "@nervekit/contracts";
import {
  ProtocolRequestError,
  type ProtocolRequestOptions,
  protocolRequest as sharedProtocolRequest,
} from "@nervekit/protocol";

export { ProtocolRequestError };

export function sandboxProtocolRequest<M extends OperationName>(
  sandboxId: string,
  method: M,
  params: OperationParams<M>,
  options: Pick<ProtocolRequestOptions, "idempotencyKey" | "timeoutMs"> = {},
): Promise<{ result: OperationResult<M>; cursor?: SnapshotCursor }> {
  return protocolRequest(method, params, {
    ...options,
    target: { role: "sandbox_agent", id: sandboxId },
  });
}

export function protocolRequest<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  options: Pick<
    ProtocolRequestOptions,
    "idempotencyKey" | "timeoutMs" | "target"
  > & { target: NonNullable<ProtocolRequestOptions["target"]> },
): Promise<{ result: OperationResult<M>; cursor?: SnapshotCursor }> {
  return sharedProtocolRequest(method, params, {
    ...options,
    apiPath: "/api/protocol/v1",
    sourceName: "Nerve Sandbox Manager UI",
  });
}
