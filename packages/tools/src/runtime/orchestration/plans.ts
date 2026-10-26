import type { ToolExecutionResult } from "../../execution/execution-context.js";
import type { ToolHandlerRegistry } from "../types.js";
import { parsePlanRequest } from "./args.js";

export type PlanPort = {
  present(
    identity: unknown,
    request: ReturnType<typeof parsePlanRequest>,
  ): Promise<ToolExecutionResult>;
};

export function createPlanHandlers(port: PlanPort): ToolHandlerRegistry {
  return {
    plan_present: (args, context) =>
      port.present(context.identity, parsePlanRequest(args)),
  };
}
