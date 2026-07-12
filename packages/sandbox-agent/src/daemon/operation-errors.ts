import { SandboxOperationError } from "./errors.js";

export function mapRuntimeError(error: unknown): SandboxOperationError {
  if (error instanceof SandboxOperationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("UNAVAILABLE"))
    return new SandboxOperationError("UNAVAILABLE", message);
  if (message.startsWith("INVALID_RUN_STATE"))
    return new SandboxOperationError("INVALID_RUN_STATE", message);
  if (message.startsWith("VALIDATION_FAILED"))
    return new SandboxOperationError("VALIDATION_FAILED", message);
  return new SandboxOperationError("INTERNAL_ERROR", message.slice(0, 500));
}

export function mapWaitError(
  error: unknown,
  unknownCode:
    | "UNKNOWN_INPUT_REQUEST"
    | "UNKNOWN_APPROVAL"
    | "UNKNOWN_PLAN_REVIEW",
): SandboxOperationError {
  const message = error instanceof Error ? error.message : String(error);
  if (/Conflicting/.test(message))
    return new SandboxOperationError("IDEMPOTENCY_CONFLICT", message);
  if (/already resolved|already answered|already/i.test(message))
    return new SandboxOperationError("ALREADY_RESOLVED", message);
  if (/mismatch/.test(message))
    return new SandboxOperationError("VALIDATION_FAILED", message);
  return new SandboxOperationError(unknownCode, message);
}
