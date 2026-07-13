import {
  executeBash,
  type ToolExecutionResult,
} from "@nervekit/host-runtime/tools";
import type {
  RunExecutionOutcome,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import {
  type AgentRecord,
  createId,
  type ToolCallRecord,
} from "@nervekit/contracts";
import type { WorkbenchAgentMechanicsDeps } from "./workbench-agent-mechanics.js";
import { toToolCallTranscriptRecord } from "../../tools/tool-call-transcript-preview.js";
import {
  bashExecutionMessageForToolCall,
  inlineCommandDisplayText,
  inlineCommandEntryDetails,
} from "./inline-command-results.js";

export class InlineCommandRunner {
  constructor(readonly deps: WorkbenchAgentMechanicsDeps) {}

  async executeBashCommand(
    agent: AgentRecord,
    command: string,
    options: {
      runId: string;
      signal?: AbortSignal;
      continueAfterPromotedTask?: boolean;
      useForegroundBash?: boolean;
    },
  ): Promise<ToolCallRecord> {
    const toolCall = await this.deps.tools.requestToolAndWait(
      agent,
      "bash",
      { command },
      {
        runId: options.runId,
        signal: options.signal,
        continueAfterPromotedTask: options.continueAfterPromotedTask,
        useForegroundBash: options.useForegroundBash,
      },
    );
    if (options.signal?.aborted) throw new Error("Command execution aborted.");
    return toolCall;
  }

  async executePromptBlockCommand(
    agent: AgentRecord,
    command: string,
    options: { signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    return executeBash(
      { command },
      {
        cwd: agent.projectDir,
        signal: options.signal,
        dataDir: this.deps.storage.paths.home,
        shellPath: this.deps.storage.settings.runtime.shellPath,
      },
    );
  }

  async runCoordinatorPrompt(input: {
    agent: AgentRecord;
    command: string;
    runId: string;
    sink: RunExecutionSink;
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome> {
    try {
      const toolCall = await this.executeBashCommand(
        input.agent,
        input.command,
        {
          runId: input.runId,
          signal: input.signal,
          continueAfterPromotedTask: false,
          useForegroundBash: false,
        },
      );
      await input.sink.upsertToolCalls([toToolCallTranscriptRecord(toolCall)]);
      const entryId = createId("entry");
      const createdAt = new Date().toISOString();
      await this.deps.harnessStorage.appendAgentMessageWithId(
        input.agent,
        entryId,
        bashExecutionMessageForToolCall(toolCall, createdAt),
        createdAt,
      );
      const entry = await this.deps.appendEntry(
        {
          id: entryId,
          conversationId: input.agent.conversationId,
          agentId: input.agent.id,
          runId: input.runId,
          role: "system",
          kind: "message",
          text: inlineCommandDisplayText(toolCall),
          details: inlineCommandEntryDetails(toolCall),
          createdAt,
        },
        { mirrorToHarness: false },
      );
      await input.sink.appendEntries([entry]);
      return { status: "completed", result: { finalEntryId: entry.id } };
    } catch (error) {
      if (input.signal.aborted) {
        return { status: "interrupted", message: "Command execution aborted." };
      }
      return {
        status: "failed",
        failure: {
          code: "INLINE_COMMAND_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      };
    }
  }
}
