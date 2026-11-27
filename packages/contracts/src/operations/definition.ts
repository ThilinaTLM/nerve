import type { z } from "zod";
import type { PeerRole } from "../wire/envelope.js";

export type OperationKind = "read" | "mutation" | "accepted_async";
export type OperationInvocationScope = "stateless" | "session";

export interface OperationDefinition<
  Method extends string = string,
  ParamsSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
> {
  readonly method: Method;
  readonly paramsSchema: ParamsSchema;
  readonly resultSchema: ResultSchema;
  readonly kind: OperationKind;
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
>(
  method: Method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  kind: OperationKind,
  allowedTargetRoles: readonly PeerRole[],
  requiredCapability: string,
  options: {
    readonly invocationScope?: OperationInvocationScope;
    readonly trustedResult?: boolean;
  } = {},
): OperationDefinition<Method, ParamsSchema, ResultSchema> {
  return {
    method,
    paramsSchema,
    resultSchema,
    kind,
    allowedTargetRoles,
    requiredCapability,
    invocationScope: options.invocationScope ?? "stateless",
    trustedResult: options.trustedResult ?? false,
  };
}
