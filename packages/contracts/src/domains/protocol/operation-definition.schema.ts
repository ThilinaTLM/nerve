import type { z } from "zod";
import type { PeerRole } from "./envelope.schema.js";

export type OperationKind = "read" | "mutation" | "accepted_async";
export type OperationIdempotency = "none" | "recommended" | "required";

export interface OperationDefinition<
  Method extends string = string,
  ParamsSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
> {
  readonly method: Method;
  readonly paramsSchema: ParamsSchema;
  readonly resultSchema: ResultSchema;
  readonly kind: OperationKind;
  readonly idempotency: OperationIdempotency;
  readonly allowedTargetRoles: readonly PeerRole[];
  readonly requiredCapability: string;
}

export function defineOperation<
  const Method extends string,
  ParamsSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
>(
  method: Method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  kind: OperationKind,
  idempotency: OperationIdempotency,
  allowedTargetRoles: readonly PeerRole[],
  requiredCapability: string,
): OperationDefinition<Method, ParamsSchema, ResultSchema> {
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
