import type { z } from "zod";
import type { PeerRole } from "../wire/envelope.js";

export type OperationKind = "read" | "mutation" | "accepted_async";
export type OperationIdempotency = "none" | "recommended" | "required";
export type OperationInvocationScope = "stateless" | "session";

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
  readonly invocationScope: OperationInvocationScope;
  /**
   * Bulk read results produced by trusted code on both ends. Peers may skip
   * result schema validation unless they opt in to validating trusted results.
   */
  readonly trustedResult: boolean;
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
  options: {
    readonly invocationScope?: OperationInvocationScope;
    readonly trustedResult?: boolean;
  } = {},
): OperationDefinition<Method, ParamsSchema, ResultSchema, Idempotency> {
  return {
    method,
    paramsSchema,
    resultSchema,
    kind,
    idempotency,
    allowedTargetRoles,
    requiredCapability,
    invocationScope: options.invocationScope ?? "stateless",
    trustedResult: options.trustedResult ?? false,
  };
}
