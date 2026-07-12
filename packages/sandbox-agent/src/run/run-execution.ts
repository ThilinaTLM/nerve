import {
  type AgentHarness,
  type AgentMessage,
  isAgentToolSuspension,
} from "@nervekit/host-runtime/harness";
import type { RunPromptRecord, RunRecord } from "@nervekit/contracts";
import type {
  CheckpointCommand,
  RunExecution,
  RunExecutionControl,
  RunExecutionFactoryPort,
  RunExecutionOutcome,
  RunExecutionSink,
  WaitCommand,
} from "@nervekit/host-runtime";
import {
  createNoopLogger,
  findExecutableCommandBlocks,
  formatInlineCommandResultText,
  replaceExecutableCommandBlocks,
  type SandboxConfigV1,
  type StructuredLogger,
} from "@nervekit/contracts";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { HarnessFactory } from "../agent/harness-factory.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { SandboxInteractionChannel } from "./interaction-channel.js";
import type { SandboxLiveHarnessRegistry } from "./live-registry.js";
import type { SandboxPendingInteractions } from "./pending-interactions.js";
import type { SandboxRunReferences } from "./run-references.js";

const NOOP_LOGGER = createNoopLogger();

export interface SandboxRunExecutionDeps {
  config: SandboxConfigV1;
  harnessFactory: HarnessFactory;
  references: SandboxRunReferences;
  live: SandboxLiveHarnessRegistry;
  channel: SandboxInteractionChannel;
  pending: SandboxPendingInteractions;
  toolRuntime?: SandboxToolRuntime;
  configStore?: AgentConfigStore;
  logger?: StructuredLogger;
}

/**
 * Constructs the real AgentHarness-backed execution for one run attempt. The
 * factory reports every durable lifecycle effect through the supplied
 * RunExecutionSink and never mutates canonical run state directly.
 */
export class SandboxRunExecutionFactory implements RunExecutionFactoryPort {
  constructor(private readonly deps: SandboxRunExecutionDeps) {}

  async create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution> {
    return new SandboxRunExecution(run, sink, this.deps);
  }
}

class SandboxRunExecution implements RunExecution {
  private harness?: AgentHarness;
  private readonly abort = new AbortController();

  constructor(
    private readonly run: RunRecord,
    private readonly sink: RunExecutionSink,
    private readonly deps: SandboxRunExecutionDeps,
  ) {}

  readonly control: RunExecutionControl = {
    steer: async (prompt) => this.steer(prompt),
    followUp: async (prompt) => this.followUp(prompt),
    continue: async () => this.deliverResolution(),
    cancel: async () => {
      this.abort.abort("cancelled");
      await this.harness?.abort().catch(() => undefined);
    },
  };

  private get scope() {
    return {
      conversationId: this.run.conversationId,
      agentId: this.run.agentId,
      runId: this.run.runId,
      executionId: this.run.executionId,
    };
  }

  async execute(input: {
    run: RunRecord;
    command: "start" | "continue";
    prompt?: string;
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome> {
    const log = (this.deps.logger ?? NOOP_LOGGER).child({
      runId: this.run.runId,
      executionId: this.run.executionId,
    });
    if (input.signal.aborted) return { status: "interrupted", message: "aborted" };
    input.signal.addEventListener("abort", () => this.abort.abort(), {
      once: true,
    });
    let harness: AgentHarness;
    try {
      harness = await this.deps.harnessFactory.create(this.scope);
    } catch (error) {
      return { status: "failed", failure: normalizeFailure(error) };
    }
    this.harness = harness;
    this.deps.live.set(this.run.runId, { harness, abort: this.abort });
    const dispose = harness.subscribe((event) =>
      void this.project(event).catch((error) =>
        log.warn("run projection failed", { err: error }),
      ),
    );
    try {
      if (input.command === "continue") {
        await harness.continue();
      } else {
        const prompt = await this.resolvePrompt(input.prompt ?? "");
        await harness.prompt(prompt);
      }
      if (this.abort.signal.aborted) {
        return { status: "interrupted", message: "aborted" };
      }
      await this.sink.checkpoint(
        await this.checkpointCommand("after_provider_response"),
      );
      return { status: "completed" };
    } catch (error) {
      if (isAgentToolSuspension(error)) {
        await this.enterWait(error.data.toolCallId, error.data.toolName);
        return { status: "suspended" };
      }
      if (this.abort.signal.aborted) {
        return { status: "interrupted", message: "aborted" };
      }
      return { status: "failed", failure: normalizeFailure(error) };
    } finally {
      dispose();
      this.deps.live.delete(this.run.runId);
    }
  }

  private async resolvePrompt(prompt: string): Promise<string> {
    if (findExecutableCommandBlocks(prompt).length === 0) return prompt;
    const runtime = this.deps.toolRuntime;
    if (!runtime) return prompt;
    const replacements = [];
    for (const block of findExecutableCommandBlocks(prompt)) {
      const result = await runtime.execute(
        "bash",
        { command: block.command },
        { ...this.scope, signal: this.abort.signal },
      );
      replacements.push({
        block,
        text: formatInlineCommandResultText({
          command: block.command,
          output: result.content || "(no output)",
          status: "completed",
          exitCode: result.exitCode,
        }),
      });
    }
    return replaceExecutableCommandBlocks(prompt, replacements);
  }

  private async steer(prompt: RunPromptRecord): Promise<void> {
    await this.harness?.steer(prompt.text, { id: prompt.id });
  }

  private async followUp(prompt: RunPromptRecord): Promise<void> {
    await this.harness?.followUp(prompt.text, { id: prompt.id });
  }

  /**
   * Called by the coordinator after resolveInteraction commits. Delivers the
   * durable resolution to the live tool awaiting on the interaction channel.
   */
  private async deliverResolution(): Promise<void> {
    const state = await this.deps.references.loadRun(this.run.runId);
    if (!state) return;
    for (const interaction of state.interactions) {
      if (interaction.status === "resolved" && interaction.resolution) {
        this.deps.channel.deliver(interaction.id, interaction.resolution);
      }
    }
  }

  private async enterWait(toolCallId: string, toolName: string): Promise<void> {
    const command = this.deps.pending.take(toolCallId);
    // The interaction id defaults to the provider toolCallId so client
    // resolution ids, the durable interaction, and the tool's resume lookup
    // align; plan review overrides it with the review record id.
    const interactionId = command?.interactionId ?? toolCallId;
    const checkpoint = await this.checkpointCommand("suspension", interactionId);
    const wait: WaitCommand = command
      ? { ...command, interactionId, toolCallId, checkpoint }
      : {
          kind: "question",
          interactionId,
          toolCallId,
          prompt: `Waiting on ${toolName}`,
          required: true,
          checkpoint,
        };
    await this.sink.wait(wait);
  }

  private async checkpointCommand(
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand> {
    const transcript = await this.deps.references.transcript(this.run.runId);
    const toolCalls = await this.deps.references.toolCalls(this.run.runId);
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

  private async project(event: {
    type: string;
    message?: AgentMessage;
    toolCallId?: string;
    toolName?: string;
  }): Promise<void> {
    if (event.type === "message_update") {
      this.sink.progress({
        type: "conversation.live.updated",
        occurredAt: new Date().toISOString(),
        data: {
          conversationId: this.run.conversationId,
          agentId: this.run.agentId,
          runId: this.run.runId,
        },
      });
      return;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = messageText(event.message);
      if (!text) return;
      await this.sink.appendEntries([
        {
          id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversationId: this.run.conversationId,
          agentId: this.run.agentId,
          runId: this.run.runId,
          role: "assistant",
          kind: "message",
          text: text.slice(0, 200_000),
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}

function normalizeFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.startsWith("UNAVAILABLE") ? "UNAVAILABLE" : "PROVIDER_FAILED",
    message: message.slice(0, 2_000),
    retryable: true,
  };
}
