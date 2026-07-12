export class SandboxOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SandboxOperationError";
  }
}
