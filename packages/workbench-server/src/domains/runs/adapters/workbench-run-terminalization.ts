import {
  INTERRUPTED_TOOL_ERROR_CODE,
  type RunRecord,
} from "@nervekit/contracts";
import { isTerminalRunStatus } from "../runtime/run-transitions.js";
import type { RunTerminalizationPort } from "../runtime/run-execution.js";
import type { ToolService } from "../../tools/execution/tool-service.js";
import { RUN_CANCELLED_TOOL_OUTCOME } from "../../tools/execution/tool-termination.js";

const TERMINAL_TOOL_OUTCOMES = {
  completed: {
    status: "failed",
    code: INTERRUPTED_TOOL_ERROR_CODE,
    message:
      "Tool execution ended without a terminal result before the run completed.",
  },
  failed: {
    status: "failed",
    code: INTERRUPTED_TOOL_ERROR_CODE,
    message: "Tool execution was interrupted because the run failed.",
  },
  cancelled: RUN_CANCELLED_TOOL_OUTCOME,
} as const;

/** Enforces that a terminal run cannot leave run-owned tool calls live. */
export class WorkbenchRunTerminalization implements RunTerminalizationPort {
  constructor(private readonly tools: ToolService) {}

  async terminalize(run: RunRecord): Promise<void> {
    if (!isTerminalRunStatus(run.status)) {
      return;
    }
    await this.tools.terminateNonTerminalToolCallsForRun(
      run.runId,
      TERMINAL_TOOL_OUTCOMES[run.status],
    );
  }
}
