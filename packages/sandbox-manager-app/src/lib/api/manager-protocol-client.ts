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
  > = {},
): Promise<{ result: OperationResult<M>; cursor?: SnapshotCursor }> {
  const routed = routeSandboxHostOperation(method, params, options.target);
  return sharedProtocolRequest(method, routed.params, {
    ...options,
    apiPath: "/api/protocol/v1",
    sourceName: "Nerve Sandbox Manager UI",
    target: routed.target,
  });
}

function routeSandboxHostOperation<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  explicitTarget: ProtocolRequestOptions["target"],
): {
  params: OperationParams<M>;
  target: NonNullable<ProtocolRequestOptions["target"]>;
} {
  if (explicitTarget) return { params, target: explicitTarget };
  if (
    !method.startsWith("sandbox.") &&
    params !== null &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    typeof (params as { sandboxId?: unknown }).sandboxId === "string"
  ) {
    const { sandboxId, ...domainParams } = params as Record<string, unknown> & {
      sandboxId: string;
    };
    return {
      params: domainParams as OperationParams<M>,
      target: { role: "sandbox_agent", id: sandboxId },
    };
  }
  return { params, target: { role: "sandbox_manager" } };
}
