import type { ToolExecutionResult } from "../../types.js";
import type { ToolHandlerRegistry } from "../types.js";
import { optionalString, parsePlanRequest } from "./args.js";

export type PlanPort = {
  enter(identity: unknown, reason?: string): Promise<ToolExecutionResult>;
  present(
    identity: unknown,
    request: ReturnType<typeof parsePlanRequest>,
  ): Promise<ToolExecutionResult>;
  forceExit(identity: unknown, reason?: string): Promise<ToolExecutionResult>;
};

export function createPlanHandlers(port: PlanPort): ToolHandlerRegistry {
  return {
    plan_mode_enter: (args, context) =>
      port.enter(context.identity, optionalString(args.reason)),
    plan_mode_present: (args, context) =>
      port.present(context.identity, parsePlanRequest(args)),
    plan_mode_force_exit: (args, context) =>
      port.forceExit(context.identity, optionalString(args.reason)),
  };
}
