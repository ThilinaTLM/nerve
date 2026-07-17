import type { RunPromptRecord, RunRecord } from "@nervekit/contracts";
import type {
  CheckpointCommand,
  RunExecution,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import type { WorkbenchAgentMechanics } from "../agents/run/workbench-agent-mechanics.js";
import type { WorkbenchRunExecutionAdapter } from "./run-execution.js";
import type { WorkbenchLiveExecutionControl } from "./run-live-executions.js";
import type { WorkbenchRunReferences } from "./run-references.js";

/**
 * Adapts the real workbench harness mechanics to the coordinator execution
 * boundary. The mutable control reference is live-only; all durable effects
 * are reported through the supplied sink.
 */
export class WorkbenchAgentExecutionAdapter implements WorkbenchRunExecutionAdapter {
  constructor(
    private readonly runner: WorkbenchAgentMechanics,
    private readonly references: WorkbenchRunReferences,
  ) {}

  async create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution> {
    let installed: WorkbenchLiveExecutionControl | undefined;
    let cancelled = false;
    const pending: Array<{
      method: "steer" | "followUp";
      prompt: RunPromptRecord;
    }> = [];
    const forwarding = new Map<string, Promise<void>>();

    const forward = (
      control: WorkbenchLiveExecutionControl,
      queued: (typeof pending)[number],
    ) => {
      const promise = control[queued.method](queued.prompt).finally(() => {
        forwarding.delete(queued.prompt.id);
      });
      forwarding.set(queued.prompt.id, promise);
      void promise.catch(() => undefined);
    };

    const installControl = (control: WorkbenchLiveExecutionControl) => {
      installed = control;
      if (cancelled) void control.cancel("run cancelled before harness start");
      for (const queued of pending.splice(0)) forward(control, queued);
    };

    const control: WorkbenchLiveExecutionControl = {
      steer: async (prompt) => {
        if (installed) return installed.steer(prompt);
        pending.push({ method: "steer", prompt });
      },
      followUp: async (prompt) => {
        if (installed) return installed.followUp(prompt);
        pending.push({ method: "followUp", prompt });
      },
      continue: async () => installed?.continue(),
      cancel: async (reason) => {
        cancelled = true;
        pending.length = 0;
        await installed?.cancel(reason);
      },
      removeQueuedPrompt: async (promptId) => {
        const pendingIndex = pending.findIndex(
          (queued) => queued.prompt.id === promptId,
        );
        if (pendingIndex !== -1) {
          pending.splice(pendingIndex, 1);
          return true;
        }
        const forwardingPrompt = forwarding.get(promptId);
        if (forwardingPrompt) await forwardingPrompt;
        return (await installed?.removeQueuedPrompt(promptId)) ?? false;
      },
      updateAgentRuntimeConfig: async (agent) =>
        installed?.updateAgentRuntimeConfig?.(agent),
      appendExternalMessage: async (input) =>
        installed?.appendExternalMessage?.(input),
      enqueueHarnessMessage: async (input) =>
        installed?.enqueueHarnessMessage?.(input),
    };

    return {
      control,
      execute: (input) =>
        this.runner.runCoordinatorExecution({
          ...input,
          sink,
          installControl,
          checkpointCommand: (boundary, interactionId) =>
            this.checkpointCommand(run.runId, boundary, interactionId),
        }),
    };
  }

  private async checkpointCommand(
    runId: string,
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand> {
    const transcript = await this.references.transcript(runId);
    const toolCalls = await this.references.toolCalls(runId);
    return {
      boundary,
      transcriptCursor: transcript.cursor,
      entryIds: transcript.entryIds,
      harnessLeafId: transcript.harnessLeafId,
      harnessSavePointId: transcript.harnessSavePointId,
      toolCalls: toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        lifecycleRevision: call.lifecycleRevision,
      })),
      interactionId,
    };
  }
}
