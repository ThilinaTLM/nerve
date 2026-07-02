import {
  type SandboxCommandMethod,
  sandboxCommandParamsByMethod,
} from "@nervekit/shared";
import { SandboxCommandError } from "./errors.js";

export type CommandHandler = (params: unknown) => Promise<unknown> | unknown;
export class SandboxCommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();
  register(method: SandboxCommandMethod, handler: CommandHandler): void {
    this.handlers.set(method, handler);
  }
  async dispatch(method: string, params: unknown): Promise<unknown> {
    const schema = sandboxCommandParamsByMethod[method as SandboxCommandMethod];
    if (!schema)
      throw new SandboxCommandError(
        "VALIDATION_FAILED",
        `Unknown sandbox command: ${method}`,
      );
    const parsed = schema.parse(params);
    const handler = this.handlers.get(method);
    if (!handler)
      throw new SandboxCommandError(
        "UNAVAILABLE",
        `No handler registered for ${method}`,
      );
    return handler(parsed);
  }
}
