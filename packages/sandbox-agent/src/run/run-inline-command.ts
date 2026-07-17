import {
  formatInlineCommandResultText,
  parseInlineCommandPrompt,
  type RunRecord,
} from "@nervekit/contracts";
import type {
  RunExecutionOutcome,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import { sandboxSha256Digest } from "../state/hash.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import { normalizeFailure } from "./run-execution-errors.js";
import type { SandboxRunScope } from "./run-harness-session.js";
import type { SandboxToolCallTracker } from "./run-tool-call-tracker.js";

/**
 * Executes inline-only start prompts (`!command`) directly through bash:
 * deterministic inline tool/entry ids, running/completed tool records, a
 * formatted system entry, and normalized failure mapping — without spinning
 * up a harness turn.
 */
export class SandboxInlineCommandRunner {
  constructor(
    private readonly deps: {
      run: RunRecord;
      sink: RunExecutionSink;
      scope: SandboxRunScope;
      signal: AbortSignal;
      toolRuntime?: SandboxToolRuntime;
      toolCalls: SandboxToolCallTracker;
    },
  ) {}

  /** Returns the inline command when the prompt is an inline-only command. */
  detect(prompt: string): string | undefined {
    return parseInlineCommandPrompt(prompt)?.command;
  }

  async execute(command: string): Promise<RunExecutionOutcome> {
    const { run, sink, toolCalls } = this.deps;
    const runtime = this.deps.toolRuntime;
    if (!runtime) {
      return {
        status: "failed",
        failure: {
          code: "UNAVAILABLE",
          message: "Inline command tool runtime is unavailable",
          retryable: false,
        },
      };
    }
    try {
      const providerToolCallId = `inline_${sandboxSha256Digest(`${run.runId}:${command}`).slice(7, 23)}`;
      const started = toolCalls.record(providerToolCallId, "bash", "running", {
        command,
      });
      if (started) await sink.upsertToolCalls([started]);
      const result = await runtime.execute(
        "bash",
        { command },
        {
          ...this.deps.scope,
          toolCallId: providerToolCallId,
          signal: this.deps.signal,
        },
      );
      const completed = toolCalls.record(
        providerToolCallId,
        "bash",
        "completed",
        undefined,
        result,
      );
      if (completed) await sink.upsertToolCalls([completed]);
      const text = formatInlineCommandResultText({
        command,
        output: result.content || "(no output)",
        status: "completed",
        exitCode: result.exitCode,
      });
      await sink.appendEntries([
        {
          id: `entry_${sandboxSha256Digest(`${run.runId}:inline:${run.attempt}`).slice(7, 23)}`,
          conversationId: run.conversationId,
          agentId: run.agentId,
          runId: run.runId,
          role: "system",
          kind: "message",
          text: text.slice(0, 200_000),
          details: { type: "inline_command_result", command },
          createdAt: new Date().toISOString(),
        },
      ]);
      return { status: "completed" };
    } catch (error) {
      return { status: "failed", failure: normalizeFailure(error) };
    }
  }
}
