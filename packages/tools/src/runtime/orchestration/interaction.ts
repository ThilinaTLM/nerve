import type { ToolExecutionResult } from "../../types.js";
import type { ToolHandlerRegistry } from "../types.js";
import { parseQuestion } from "./args.js";

export type InteractionPort = {
  resolve(identity: unknown): Promise<ToolExecutionResult | undefined>;
  request(
    identity: unknown,
    input: ReturnType<typeof parseQuestion>,
  ): Promise<ToolExecutionResult>;
};

export function createInteractionHandlers(
  port: InteractionPort,
): ToolHandlerRegistry {
  return {
    ask_user: async (args, context) => {
      const resolved = await port.resolve(context.identity);
      if (resolved) return resolved;
      return port.request(context.identity, parseQuestion(args));
    },
  };
}
