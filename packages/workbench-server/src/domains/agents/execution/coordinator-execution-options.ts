import type { PromptRequest } from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import type {
  CheckpointCommand,
  RunExecutionSink,
} from "../../runs/runtime/index.js";
import type { WorkbenchLiveExecutionControl } from "../../runs/application/run-live-executions.js";

export interface CoordinatorExecutionOptions {
  run: RunRecord;
  sink: RunExecutionSink;
  command: "start" | "continue";
  prompt?: string;
  images?: PromptRequest["images"];
  signal: AbortSignal;
  installControl(control: WorkbenchLiveExecutionControl): void;
  checkpointCommand(
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand>;
}
