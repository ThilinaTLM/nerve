import type { z } from "zod";
import type { PeerRole } from "./envelope.schema.js";

export type OperationKind = "read" | "mutation" | "accepted_async";
export type OperationIdempotency = "none" | "recommended" | "required";

export interface OperationDefinition<Method extends string = string> {
  readonly method: Method;
  readonly paramsSchema: z.ZodType;
  readonly resultSchema: z.ZodType;
  readonly kind: OperationKind;
  readonly idempotency: OperationIdempotency;
  readonly allowedTargetRoles: readonly PeerRole[];
  readonly requiredCapability: string;
}

export function defineOperation<const Method extends string>(
  method: Method,
  paramsSchema: z.ZodType,
  resultSchema: z.ZodType,
  kind: OperationKind,
  idempotency: OperationIdempotency,
  allowedTargetRoles: readonly PeerRole[],
  requiredCapability: string,
): OperationDefinition<Method> {
  return {
    method,
    paramsSchema,
    resultSchema,
    kind,
    idempotency,
    allowedTargetRoles,
    requiredCapability,
  };
}
