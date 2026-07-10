import type { ToolExecutionResult } from "../../types.js";
import type { ToolHandlerRegistry } from "../types.js";
import { parseExploreRequest } from "./args.js";

export type ExplorePort = {
  run(
    request: ReturnType<typeof parseExploreRequest>,
    identity: unknown,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult>;
};

export function createExploreHandlers(port: ExplorePort): ToolHandlerRegistry {
  return {
    explore: (args, context) =>
      port.run(parseExploreRequest(args), context.identity, context.signal),
  };
}
