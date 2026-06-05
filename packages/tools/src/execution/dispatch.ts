import type { ToolName } from "@nerve/shared";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { executeBash } from "./bash.js";
import { executeEdit } from "./edit.js";
import { executeFind } from "./find.js";
import { executeLs } from "./list.js";
import { executeRead } from "./read.js";
import { executeGrep } from "./search.js";
import { executeWrite } from "./write.js";

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  switch (name) {
    case "read":
      return executeRead(args, context);
    case "bash":
      return executeBash(args, context);
    case "edit":
      return executeEdit(args, context);
    case "write":
      return executeWrite(args, context);
    case "grep":
      return executeGrep(args, context);
    case "find":
      return executeFind(args, context);
    case "ls":
      return executeLs(args, context);
    case "ask_user":
      throw new Error(
        "ask_user is executed by the orchestrator user-interaction service.",
      );
    case "todos_set":
    case "todos_get":
      throw new Error(
        `${name} is executed by the orchestrator task-state service.`,
      );
    case "process_start":
    case "process_stop":
    case "process_restart":
    case "process_list":
    case "process_logs":
      // packages/tools executes only core local tools. Managed process tools are
      // orchestration tools: descriptors are shared for prompting/API purposes,
      // but execution is mediated by the orchestrator process manager.
      throw new Error(
        `${name} is executed by the orchestrator process manager.`,
      );
    case "subagent_run":
      // Subagents require runtime/session authority checks owned by orchestrator.
      throw new Error(`${name} is executed by the orchestrator agent runtime.`);
    case "plan_mode_enter":
    case "plan_mode_present":
    case "plan_mode_force_exit":
      // Plan mode requires runtime/session state and user-review waiters owned by orchestrator.
      throw new Error(`${name} is executed by the orchestrator plan service.`);
  }
}
