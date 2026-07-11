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
  const routed = routeSandboxHostOperation(method, params, options.target);
  return sharedProtocolRequest<T>(method, routed.params, {
    ...options,
    apiPath: "/api/protocol/v1",
    sourceName: "Nerve Sandbox Manager UI",
    target: routed.target,
  });
}

function routeSandboxHostOperation(
  method: OperationName,
  params: unknown,
  explicitTarget: ProtocolRequestOptions["target"],
): { params: unknown; target: NonNullable<ProtocolRequestOptions["target"]> } {
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
      params: domainParams,
      target: { role: "sandbox_agent", id: sandboxId },
    };
  }
  return { params, target: { role: "sandbox_manager" } };
}
