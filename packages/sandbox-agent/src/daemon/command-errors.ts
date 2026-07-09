import { SandboxCommandError } from "./errors.js";

export function mapRuntimeError(error: unknown): SandboxCommandError {
  if (error instanceof SandboxCommandError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("UNAVAILABLE"))
    return new SandboxCommandError("UNAVAILABLE", message);
  if (message.startsWith("INVALID_RUN_STATE"))
    return new SandboxCommandError("INVALID_RUN_STATE", message);
  if (message.startsWith("VALIDATION_FAILED"))
    return new SandboxCommandError("VALIDATION_FAILED", message);
  return new SandboxCommandError("INTERNAL_ERROR", message.slice(0, 500));
}

export function mapWaitError(
  error: unknown,
  unknownCode: "UNKNOWN_INPUT_REQUEST" | "UNKNOWN_APPROVAL",
): SandboxCommandError {
  const message = error instanceof Error ? error.message : String(error);
  if (/Conflicting/.test(message))
    return new SandboxCommandError("IDEMPOTENCY_CONFLICT", message);
  if (/already resolved|already answered|already/i.test(message))
    return new SandboxCommandError("ALREADY_RESOLVED", message);
  if (/mismatch/.test(message))
    return new SandboxCommandError("VALIDATION_FAILED", message);
  return new SandboxCommandError(unknownCode, message);
}
