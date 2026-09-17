import type { z } from "zod";
import type { PeerRole } from "../wire/envelope.js";

export type OperationKind = "read" | "mutation" | "accepted_async";
export type OperationIdempotency = "none" | "recommended" | "required";

export interface OperationDefinition<
  Method extends string = string,
  ParamsSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
  Idempotency extends OperationIdempotency = OperationIdempotency,
> {
  readonly method: Method;
  readonly paramsSchema: ParamsSchema;
  readonly resultSchema: ResultSchema;
  readonly kind: OperationKind;
  readonly idempotency: Idempotency;
  readonly allowedTargetRoles: readonly PeerRole[];
  readonly requiredCapability: string;
}

export function defineOperation<
  const Method extends string,
  ParamsSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  const Idempotency extends OperationIdempotency,
>(
  method: Method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  kind: OperationKind,
  idempotency: Idempotency,
  allowedTargetRoles: readonly PeerRole[],
  requiredCapability: string,
): OperationDefinition<Method, ParamsSchema, ResultSchema, Idempotency> {
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
