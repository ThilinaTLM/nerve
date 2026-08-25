import type { RunRecord } from "@nervekit/contracts";
import { isTerminalRunStatus } from "../runtime/run-transitions.js";
import type { RunTerminalizationPort } from "../runtime/run-execution.js";
import type { ToolService } from "../../tools/tool-service.js";

const TERMINAL_TOOL_MESSAGES = {
  completed:
    "Tool execution ended without a terminal result before the run completed.",
  failed: "Tool execution was interrupted because the run failed.",
  cancelled: "Tool execution was interrupted because the run was cancelled.",
} satisfies Record<"completed" | "failed" | "cancelled", string>;

/** Enforces that a terminal run cannot leave run-owned tool calls live. */
export class WorkbenchRunTerminalization implements RunTerminalizationPort {
  constructor(private readonly tools: ToolService) {}

  async terminalize(run: RunRecord): Promise<void> {
    if (!isTerminalRunStatus(run.status)) {
      return;
    }
    await this.tools.terminateNonTerminalToolCallsForRun(
      run.runId,
      TERMINAL_TOOL_MESSAGES[run.status],
    );
  }
}
