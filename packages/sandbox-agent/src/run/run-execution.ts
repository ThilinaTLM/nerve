import {
  createNoopLogger,
  type PromptImage,
  type RunPromptRecord,
  type RunRecord,
  type SandboxConfigV1,
  type StructuredLogger,
} from "@nervekit/contracts";
import type {
  RunExecution,
  RunExecutionControl,
  RunExecutionFactoryPort,
  RunExecutionOutcome,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import { isAgentToolSuspension } from "@nervekit/host-runtime/harness";
import type { HarnessFactory } from "../agent/harness-factory.js";
import { sandboxSha256Digest } from "../state/hash.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import { SandboxConversationLiveProjector } from "./conversation-live-projector.js";
import type { SandboxInteractionChannel } from "./interaction-channel.js";
import type { SandboxLiveHarnessRegistry } from "./live-registry.js";
import type { SandboxPendingInteractions } from "./pending-interactions.js";
import { SandboxHarnessEventProjector } from "./run-event-projector.js";
import { assistantFailure, normalizeFailure } from "./run-execution-errors.js";
import { SandboxHarnessSession } from "./run-harness-session.js";
import { SandboxInlineCommandRunner } from "./run-inline-command.js";
import {
  buildRunCheckpoint,
  SandboxInteractionContinuation,
} from "./run-interaction-continuation.js";
import { SandboxPromptControl } from "./run-prompt-control.js";
import type { SandboxRunReferences } from "./run-references.js";
import { SandboxToolCallTracker } from "./run-tool-call-tracker.js";

const NOOP_LOGGER = createNoopLogger();

export interface SandboxRunExecutionDeps {
  config: SandboxConfigV1;
  harnessFactory: HarnessFactory;
  references: SandboxRunReferences;
  live: SandboxLiveHarnessRegistry;
  channel: SandboxInteractionChannel;
  pending: SandboxPendingInteractions;
  toolRuntime?: SandboxToolRuntime;
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
    await this.deps.harnessFactory.assertModelAvailable();
    return new SandboxRunExecution(run, sink, this.deps);
  }
}

/**
 * Orchestrates one run execution attempt across focused collaborators: the
 * harness session, prompt control, tool-call tracker, event projector, inline
 * command runner, and interaction continuation. `RunExecutionSink` remains the
 * only durable mutation route.
 */
class SandboxRunExecution implements RunExecution {
  private readonly session: SandboxHarnessSession;
  private readonly liveProjector: SandboxConversationLiveProjector;
  private readonly toolCalls: SandboxToolCallTracker;
  private readonly prompts: SandboxPromptControl;
  private readonly projector: SandboxHarnessEventProjector;
  private readonly inline: SandboxInlineCommandRunner;
  private readonly continuation: SandboxInteractionContinuation;

  constructor(
    private readonly run: RunRecord,
    private readonly sink: RunExecutionSink,
    private readonly deps: SandboxRunExecutionDeps,
  ) {
    const scope = {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      executionId: run.executionId,
    };
    this.liveProjector = new SandboxConversationLiveProjector(
      {
        conversationId: run.conversationId,
        agentId: run.agentId,
        projectId: run.projectId,
        runId: run.runId,
      },
      (type, data) =>
        sink.progress({
          type,
          occurredAt: new Date().toISOString(),
          data,
        }),
    );
    this.session = new SandboxHarnessSession({
      scope,
      harnessFactory: deps.harnessFactory,
      live: deps.live,
      log: (deps.logger ?? NOOP_LOGGER).child({
        runId: run.runId,
        executionId: run.executionId,
      }),
    });
    this.toolCalls = new SandboxToolCallTracker({
      run,
      cwd: deps.config.agent.workspaceRoot ?? process.cwd(),
      anchors: this.liveProjector,
    });
    this.prompts = new SandboxPromptControl({
      harness: () => this.session,
      toolRuntime: deps.toolRuntime,
      scope,
      signal: this.session.signal,
    });
    this.projector = new SandboxHarnessEventProjector({
      run,
      sink,
      liveProjector: this.liveProjector,
      toolCalls: this.toolCalls,
      prompts: this.prompts,
    });
    this.inline = new SandboxInlineCommandRunner({
      run,
      sink,
      scope,
      signal: this.session.signal,
      toolRuntime: deps.toolRuntime,
      toolCalls: this.toolCalls,
    });
    this.continuation = new SandboxInteractionContinuation({
      run,
      sink,
      scope,
      signal: this.session.signal,
      references: deps.references,
      harnessFactory: deps.harnessFactory,
      toolRuntime: deps.toolRuntime,
      channel: deps.channel,
      pending: deps.pending,
      toolCalls: this.toolCalls,
    });
  }

  readonly control: RunExecutionControl = {
    steer: async (prompt: RunPromptRecord) => this.prompts.steer(prompt),
    followUp: async (prompt: RunPromptRecord) => this.prompts.followUp(prompt),
    removeQueuedPrompt: async (promptId) =>
      this.prompts.removeQueuedPrompt(promptId),
    continue: async () => this.continuation.deliverResolution(),
    cancel: async () => this.session.cancel(),
  };

  async execute(input: {
    run: RunRecord;
    command: "start" | "continue";
    prompt?: string;
    images?: PromptImage[];
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome> {
    // 1. Reject an already-aborted input and attach the external abort.
    if (input.signal.aborted)
      return { status: "interrupted", message: "aborted" };
    this.session.attachExternalAbort(input.signal);
    // 2. On continue, materialize the resolved interaction first.
    if (input.command === "continue") {
      await this.continuation.materializeResolved();
    }
    // 3. On start, execute an inline-only prompt when detected.
    if (input.command === "start") {
      const command = this.inline.detect(input.prompt ?? "");
      if (command !== undefined) return this.inline.execute(command);
    }
    // 4. Create/register the harness session and connect the projector.
    try {
      await this.session.open((event) => this.projector.project(event));
    } catch (error) {
      return { status: "failed", failure: normalizeFailure(error) };
    }
    try {
      // 5. Expand the starting prompt, append the durable user entry, and
      //    invoke prompt/continue.
      const assistant =
        input.command === "continue"
          ? await this.session.continue()
          : await (async () => {
              const prompt = await this.prompts.expandPrompt(
                input.prompt ?? "",
              );
              await this.appendUserEntry(prompt);
              return this.session.prompt(prompt, { images: input.images });
            })();
      // 6. Await the complete projection tail before interpreting the result.
      await this.session.waitForProjection();
      // 7. Map abort, provider error, suspension, and unexpected failures.
      if (this.session.aborted || assistant.stopReason === "aborted") {
        return { status: "interrupted", message: "aborted" };
      }
      if (assistant.stopReason === "error") {
        const failed = assistantFailure(assistant.errorMessage);
        if (failed.retryable) {
          // 8. Rewind retryable assistant state and checkpoint the boundary.
          await this.rewindRetryableAssistant();
          await this.sink.checkpoint(
            await this.checkpoint("before_provider_request"),
          );
        }
        return { status: "failed", failure: failed };
      }
      await this.sink.checkpoint(
        await this.checkpoint("after_provider_response"),
      );
      return { status: "completed" };
    } catch (error) {
      if (isAgentToolSuspension(error)) {
        await this.continuation.enterWait(
          error.data.toolCallId,
          error.data.toolName,
        );
        return { status: "suspended" };
      }
      const serialized = this.continuation.serializedSuspension(error);
      if (serialized) {
        await this.continuation.enterWait(
          serialized.toolCallId,
          serialized.toolName,
          serialized.detail,
        );
        return { status: "suspended" };
      }
      if (this.session.aborted) {
        return { status: "interrupted", message: "aborted" };
      }
      const normalized = normalizeFailure(error);
      if (normalized.retryable) {
        await this.sink
          .checkpoint(await this.checkpoint("before_provider_request"))
          .catch(() => undefined);
      }
      return { status: "failed", failure: normalized };
    } finally {
      // 9. Dispose subscription and live registration in all paths.
      this.session.dispose();
    }
  }

  private checkpoint(
    boundary: "before_provider_request" | "after_provider_response",
  ) {
    return buildRunCheckpoint(this.deps.references, this.run.runId, boundary);
  }

  private async rewindRetryableAssistant(): Promise<void> {
    const conversation =
      await this.deps.harnessFactory.openOrCreateConversation(
        this.run.conversationId,
        this.run.agentId,
      );
    const leafId = await conversation.getLeafId();
    const leaf = leafId ? await conversation.getEntry(leafId) : undefined;
    if (
      leaf?.type === "message" &&
      leaf.message.role === "assistant" &&
      leaf.parentId !== undefined
    ) {
      await conversation.moveTo(leaf.parentId);
    }
  }

  private async appendUserEntry(prompt: string): Promise<void> {
    if (!prompt) return;
    await this.sink.appendEntries([
      {
        id: `entry_${sandboxSha256Digest(`${this.run.runId}:user:${this.run.attempt}`).slice(7, 23)}`,
        conversationId: this.run.conversationId,
        agentId: this.run.agentId,
        runId: this.run.runId,
        role: "user",
        kind: "message",
        text: prompt.slice(0, 200_000),
        createdAt: new Date().toISOString(),
      },
    ]);
  }
}
