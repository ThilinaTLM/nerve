export class SandboxStateCorruptionError extends Error {
  readonly exitCode = 30;

  constructor(
    message: string,
    readonly filePath?: string,
    readonly cause?: unknown,
  ) {
    super(filePath ? `${message}: ${filePath}` : message);
    this.name = "SandboxStateCorruptionError";
  }
}

export function asCorruptionError(
  message: string,
  filePath?: string,
  cause?: unknown,
): SandboxStateCorruptionError {
  if (cause instanceof SandboxStateCorruptionError) return cause;
  return new SandboxStateCorruptionError(message, filePath, cause);
}
