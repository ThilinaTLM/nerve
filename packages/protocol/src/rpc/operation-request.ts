import {
  operationDefinition,
  parseOperationParams,
  type OperationName,
  type OperationParams,
} from "@nervekit/contracts/operations";
import {
  protocolRequestDataSchema,
  type PeerDescriptor,
  type ProtocolRequestData,
} from "@nervekit/contracts/wire";

export interface OperationRequestFailure {
  readonly code: "AUTH_FORBIDDEN" | "VALIDATION_FAILED";
  readonly message: string;
}

export type PreparedOperationRequest =
  | {
      readonly ok: true;
      readonly data: ProtocolRequestData;
    }
  | { readonly ok: false; readonly error: OperationRequestFailure };

export function prepareOperationRequest<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  options: Pick<ProtocolRequestData, "timeoutMs" | "expect"> & {
    readonly target?: PeerDescriptor;
  } = {},
): PreparedOperationRequest {
  const operation = operationDefinition(method);
  if (
    options.target &&
    !operation.allowedTargetRoles.includes(options.target.role)
  ) {
    return {
      ok: false,
      error: {
        code: "AUTH_FORBIDDEN",
        message: `Operation ${method} cannot target ${options.target.role}`,
      },
    };
  }
  try {
    const data = protocolRequestDataSchema.parse({
      method,
      params: parseOperationParams(method, params),
      timeoutMs: options.timeoutMs,
      expect: options.expect,
    });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : `Invalid parameters for ${method}`,
      },
    };
  }
}
