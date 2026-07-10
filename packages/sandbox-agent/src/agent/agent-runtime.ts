import { type AgentHarness, isAgentToolSuspension } from "@nervekit/agent";
import {
  createNoopLogger,
  findExecutableCommandBlocks,
  formatInlineCommandResultText,
  replaceExecutableCommandBlocks,
  type SandboxConfigV1,
  type StructuredLogger,
} from "@nervekit/shared";
import type { ToolExecutionResult } from "@nervekit/tools";
import { resolveModelSelection } from "../models/model-catalog.js";
import type { ApprovalWaiter } from "../tools/approval-waiter.js";
import type { InputWaiter } from "../tools/input-waiter.js";
import type { PlanReviewWaiter } from "../tools/plan-review-waiter.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { AgentConfigStore } from "./agent-config-store.js";
import type { ExploreRuntime } from "./explore-runtime.js";

import type { HarnessEventBridge } from "./harness-event-bridge.js";
import type { HarnessFactory } from "./harness-factory.js";
import type { RunManager, RunScope } from "./run-manager.js";
import type { RunState } from "./run-state-store.js";

export type SandboxAgentRuntimeOptions = {
  runs?: RunManager;
  harnessFactory?: HarnessFactory;
  bridge?: HarnessEventBridge;
  inputWaiter?: InputWaiter;
  planReviewWaiter?: PlanReviewWaiter;
  approvalWaiter?: ApprovalWaiter;
  toolRuntime?: SandboxToolRuntime;
  exploreRuntime?: ExploreRuntime;
  configStore?: AgentConfigStore;
  logger?: StructuredLogger;
};

const NOOP_LOGGER = createNoopLogger();

type ActiveHarnessRun = {
  key: string;
  conversationId: string;
  agentId: string;
  runId: string;
  executionId: string;
  harness?: AgentHarness;
  abortController: AbortController;
  promise: Promise<void>;
  cancelling?: boolean;
};

export class SandboxAgentRuntime {
  private readonly active = new Map<string, ActiveHarnessRun>();
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly options: SandboxAgentRuntimeOptions = {},
  ) {}

  private runLog(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
    executionId?: string;
  }): StructuredLogger {
    return (this.options.logger ?? NOOP_LOGGER).child({
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      executionId: scope.executionId,
    });
  }

  describe(): Record<string, unknown> {
    return {
      defaultModel: resolveModelSelection(
        this.config,
        this.options.configStore?.effective(this.config).model ??
          this.config.agent.defaultModel,
      ),
      harness: this.options.harnessFactory?.describe(
        "conv_status",
        "agent_main",
      ),
      mode:
        this.options.configStore?.effective(this.config).mode ??
        (this.config.agent.defaultMode === "planning" ? "planning" : "coding"),
      activeRuns: this.active.size,
    };
  }

  private effectiveAgentMode(): "coding" | "planning" {
    return (
      this.options.configStore?.effective(this.config).mode ??
      (this.config.agent.defaultMode === "planning" ? "planning" : "coding")
    );
  }

  async startRun(
    input: Parameters<RunManager["createRun"]>[0],
  ): Promise<RunState> {
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    const agentMode = input.mode ?? this.effectiveAgentMode();
    if (!this.options.harnessFactory)
      return this.options.runs.start({ ...input, mode: agentMode });
    await this.options.harnessFactory.assertModelAvailable();
    const behavior = input.behavior ?? "start";
    if (behavior === "follow_up")
      await this.assertNoActiveForConversation(input);
    const prompt = input.prompt ?? "";
    const expandPromptBlocks = findExecutableCommandBlocks(prompt).length > 0;
    const { run, executionId } = await this.options.runs.createRun({
      ...input,
      appendUserEntry: !expandPromptBlocks,
      mode: agentMode,
    });
    this.runLog({ ...run, executionId }).debug("run requested", { behavior });
    this.launch(run, executionId, prompt, "prompt", { expandPromptBlocks });
    return run;
  }

  async runInlineCommandPrompt(
    input: Parameters<RunManager["createRun"]>[0] & { command: string },
  ): Promise<RunState> {
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    if (!this.options.toolRuntime)
      throw new Error("UNAVAILABLE: tool runtime is not configured");
    const behavior = input.behavior ?? "start";
    if (behavior === "follow_up")
      await this.assertNoActiveForConversation(input);
    const { run, executionId } = await this.options.runs.createRun({
      ...input,
      prompt: input.prompt ?? `!${input.command}`,
      appendUserEntry: false,
      mode: input.mode ?? this.effectiveAgentMode(),
    });
    this.runLog({ ...run, executionId }).debug("inline command requested", {
      behavior,
    });
    this.launchInlineCommand(run, executionId, input.command);
    return run;
  }

  async continueRun(scope: RunScope & { reason?: string }): Promise<void> {
    if (!this.options.runs || !this.options.harnessFactory)
      throw new Error("UNAVAILABLE: harness runtime is not configured");
    const run = await this.options.runs.read(scope);
    if (!run) throw new Error(`Unknown run: ${scope.runId}`);
    if (
      run.status !== "waiting_for_input" &&
      run.status !== "waiting_for_approval" &&
      run.status !== "recoverable_failed"
    ) {
      throw new Error(`INVALID_RUN_STATE: cannot continue ${run.status}`);
    }
    if (run.status === "waiting_for_input") {
      const pendingInput = this.options.inputWaiter?.pendingForRun(scope) ?? [];
      const pendingPlan =
        this.options.planReviewWaiter?.pendingForRun(scope) ?? [];
      if (pendingInput.length || pendingPlan.length)
        throw new Error("INVALID_RUN_STATE: user interaction is not resolved");
    }
    if (run.status === "waiting_for_approval") {
      const pending = this.options.approvalWaiter?.pendingForRun(scope) ?? [];
      if (pending.length)
        throw new Error("INVALID_RUN_STATE: approval wait is not resolved");
    }
    if (run.status === "recoverable_failed") {
      const executions = await this.options.runs.executionStore().list(scope);
      const latest = executions.at(-1);
      if (
        latest?.error?.retryable !== true &&
        latest?.recoverability !== "retryable"
      ) {
        throw new Error("INVALID_RUN_STATE: latest failure is not retryable");
      }
      await this.options.runs.writeCheckpoint(scope, "retry_decision", {
        status: "recoverable_failed",
        executionId: latest?.executionId,
        recoverable: true,
        summary: { text: scope.reason ?? "retry requested" },
      });
    }
    const { executionId } = await this.options.runs.createExecutionAttempt(
      scope,
      scope.reason ?? "continue",
    );
    this.runLog({ ...scope, executionId }).debug("run continue requested", {
      previousStatus: run.status,
    });
    this.launch(run, executionId, "", "continue");
  }

  async steerRun(scope: RunScope, text: string): Promise<void> {
    const active = this.active.get(key(scope));
    if (!active?.harness)
      throw new Error("INVALID_RUN_STATE: no active harness run");
    await this.options.runs?.appendTranscriptEntry(scope, {
      entryId: `entry_${Date.now()}_steer`,
      index: Date.now(),
      role: "user",
      content: { text: text.slice(0, 16_000) },
      createdAt: new Date().toISOString(),
    });
    this.runLog(scope).debug("run steered", { bytes: text.length });
    await active.harness.steer(text, { id: `steer_${Date.now()}` });
  }

  async cancelRun(scope: RunScope & { reason?: string }): Promise<RunState> {
    const active = this.active.get(key(scope));
    if (active) active.cancelling = true;
    this.runLog(scope).info("run cancel requested", { reason: scope.reason });
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    await this.options.toolRuntime?.cancelRun(scope);
    await this.options.exploreRuntime?.cancelRun(scope);
    active?.abortController.abort();
    await active?.harness?.abort().catch(() => undefined);
    await active?.promise.catch(() => undefined);
    this.active.delete(key(scope));
    await this.options.inputWaiter?.cancelRun(scope);
    await this.options.planReviewWaiter?.cancelRun(scope);
    await this.options.approvalWaiter?.cancelRun(scope);
    const run = await this.options.runs.cancel({
      ...scope,
      executionId: active?.executionId,
    });
    await this.options.bridge?.failRun(scope, { message: scope.reason }, true);
    return run;
  }

  async recoverActiveRuns(): Promise<void> {
    this.active.clear();
    if (!this.options.runs) return;
    for (const run of await this.options.runs.list()) {
      if (run.status === "running" || run.status === "streaming") {
        this.runLog(run).warn("recovered interrupted run", {
          previousStatus: run.status,
        });
        await this.options.runs.markFailed(
          run,
          {
            code: "RECOVERABLE_INTERRUPTED",
            message: "sandbox daemon restarted during provider execution",
            retryable: true,
          },
          true,
        );
      }
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      activeRuns: Array.from(this.active.values()).map((run) => ({
        conversationId: run.conversationId,
        agentId: run.agentId,
        runId: run.runId,
        executionId: run.executionId,
      })),
    };
  }

  private launch(
    run: RunState,
    executionId: string,
    prompt: string,
    mode: "prompt" | "continue",
    options: { expandPromptBlocks?: boolean } = {},
  ): void {
    const runs = this.options.runs;
    const harnessFactory = this.options.harnessFactory;
    if (!runs || !harnessFactory) return;
    const scope = {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      executionId,
      commandId: typeof run.commandId === "string" ? run.commandId : undefined,
    };
    const active: ActiveHarnessRun = {
      ...scope,
      key: key(scope),
      harness: undefined,
      abortController: new AbortController(),
      promise: Promise.resolve(),
    };
    this.active.set(active.key, active);
    const log = this.runLog(scope);
    const startedAt = Date.now();
    const promise = (async () => {
      let dispose: (() => void) | undefined;
      try {
        const harness = await harnessFactory.create(scope);
        active.harness = harness;
        dispose = this.options.bridge?.attach(harness, scope);
        const model =
          this.options.configStore?.effective(this.config).model ??
          this.config.agent.defaultModel;
        await runs.markRunning(scope, {
          provider: model.provider,
          model: model.model,
          thinkingLevel: model.thinkingLevel,
        });
        await this.options.bridge?.startRun(scope);
        log.info("run started", {
          mode,
          provider: model.provider,
          model: model.model,
          thinkingLevel: model.thinkingLevel,
        });
        if (mode === "continue") await harness.continue();
        else {
          const effectivePrompt = options.expandPromptBlocks
            ? await this.expandExecutablePromptBlocks(
                prompt,
                scope,
                active.abortController.signal,
              )
            : prompt;
          if (options.expandPromptBlocks) {
            await runs.appendTranscriptEntry(run, {
              entryId: `entry_${Date.now()}_0`,
              index: 0,
              role: "user",
              content: { text: effectivePrompt.slice(0, 16_000) },
              createdAt: new Date().toISOString(),
            });
          }
          await harness.prompt(effectivePrompt);
        }
        if (active.abortController.signal.aborted || active.cancelling) {
          log.info("run aborted", { durationMs: Date.now() - startedAt });
          return;
        }
        await runs.markCompleted(scope);
        await this.options.bridge?.completeRun(scope);
        log.info("run completed", { durationMs: Date.now() - startedAt });
      } catch (error) {
        if (isAgentToolSuspension(error)) {
          log.info("run suspended", {
            reason: error.data.toolName,
            durationMs: Date.now() - startedAt,
          });
          await this.options.bridge?.handleSuspension(scope, error);
          return;
        }
        const pendingSuspension = this.pendingSuspension(scope, error);
        if (pendingSuspension) {
          log.info("run suspended", {
            reason: pendingSuspension.data.toolName,
            durationMs: Date.now() - startedAt,
          });
          await this.options.bridge?.handleSuspension(scope, pendingSuspension);
          return;
        }
        if (active.abortController.signal.aborted || active.cancelling) {
          log.info("run aborted", { durationMs: Date.now() - startedAt });
          return;
        }
        log.error("run failed", {
          durationMs: Date.now() - startedAt,
          err: error,
        });
        await runs.markFailed(scope, normalizeError(error), true);
        await this.options.bridge?.failRun(scope, normalizeError(error), false);
      } finally {
        dispose?.();
        this.active.delete(key(scope));
      }
    })();
    active.promise = promise;
  }

  private launchInlineCommand(
    run: RunState,
    executionId: string,
    command: string,
  ): void {
    const runs = this.options.runs;
    const toolRuntime = this.options.toolRuntime;
    if (!runs || !toolRuntime) return;
    const scope = {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      executionId,
      commandId: typeof run.commandId === "string" ? run.commandId : undefined,
    };
    const active: ActiveHarnessRun = {
      ...scope,
      key: key(scope),
      harness: undefined,
      abortController: new AbortController(),
      promise: Promise.resolve(),
    };
    this.active.set(active.key, active);
    const log = this.runLog(scope);
    const startedAt = Date.now();
    const promise = (async () => {
      try {
        const model =
          this.options.configStore?.effective(this.config).model ??
          this.config.agent.defaultModel;
        await runs.markRunning(scope, {
          provider: model.provider,
          model: model.model,
          thinkingLevel: model.thinkingLevel,
        });
        await this.options.bridge?.startRun(scope);
        log.info("inline command run started", {
          provider: model.provider,
          model: model.model,
          thinkingLevel: model.thinkingLevel,
        });
        const result = await this.executeInlineBashCommand(
          command,
          scope,
          active.abortController.signal,
        );
        if (active.abortController.signal.aborted || active.cancelling) {
          log.info("inline command run aborted", {
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        await runs.appendTranscriptEntry(run, {
          entryId: `entry_${Date.now()}_inline_command`,
          index: 0,
          role: "system",
          content: {
            text: this.inlineCommandResultText(command, result).slice(
              0,
              16_000,
            ),
          },
          details: {
            type: "inline_command_result",
            command,
            toolName: "bash",
            isError:
              typeof result.exitCode === "number" && result.exitCode !== 0,
          },
          createdAt: new Date().toISOString(),
        });
        await runs.markCompleted(scope);
        await this.options.bridge?.completeRun(scope);
        log.info("inline command run completed", {
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (isAgentToolSuspension(error)) {
          log.info("inline command run suspended", {
            reason: error.data.toolName,
            durationMs: Date.now() - startedAt,
          });
          await this.options.bridge?.handleSuspension(scope, error);
          return;
        }
        const pendingSuspension = this.pendingSuspension(scope, error);
        if (pendingSuspension) {
          log.info("inline command run suspended", {
            reason: pendingSuspension.data.toolName,
            durationMs: Date.now() - startedAt,
          });
          await this.options.bridge?.handleSuspension(scope, pendingSuspension);
          return;
        }
        if (active.abortController.signal.aborted || active.cancelling) {
          log.info("inline command run aborted", {
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        log.error("inline command run failed", {
          durationMs: Date.now() - startedAt,
          err: error,
        });
        await runs.markFailed(scope, normalizeError(error), true);
        await this.options.bridge?.failRun(scope, normalizeError(error), false);
      } finally {
        this.active.delete(key(scope));
      }
    })();
    active.promise = promise;
  }

  private async expandExecutablePromptBlocks(
    prompt: string,
    scope: RunScope & { executionId?: string },
    signal?: AbortSignal,
  ): Promise<string> {
    const blocks = findExecutableCommandBlocks(prompt);
    if (blocks.length === 0) return prompt;
    const replacements = [];
    for (const block of blocks) {
      if (signal?.aborted) throw new Error("Command execution aborted.");
      const result = await this.executeInlineBashCommand(
        block.command,
        scope,
        signal,
      );
      replacements.push({
        block,
        text: this.inlineCommandResultText(block.command, result),
      });
    }
    return replaceExecutableCommandBlocks(prompt, replacements);
  }

  private async executeInlineBashCommand(
    command: string,
    scope: RunScope & { executionId?: string },
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const toolRuntime = this.options.toolRuntime;
    if (!toolRuntime)
      throw new Error("UNAVAILABLE: tool runtime is not configured");
    return toolRuntime.execute("bash", { command }, { ...scope, signal });
  }

  private inlineCommandResultText(
    command: string,
    result: ToolExecutionResult,
  ): string {
    return formatInlineCommandResultText({
      command,
      output: result.content || "(no output)",
      status: "completed",
      exitCode: result.exitCode,
    });
  }

  private pendingSuspension(
    scope: RunScope,
    error: unknown,
  ):
    | { data: { toolCallId: string; toolName: string; reason: string } }
    | undefined {
    const message = error instanceof Error ? error.message : String(error);
    if (!/WAITING_FOR_(INPUT|APPROVAL|PLAN_REVIEW)/.test(message))
      return undefined;
    const input = this.options.inputWaiter?.pendingForRun(scope)[0];
    if (input)
      return {
        data: {
          toolCallId: input.requestId,
          toolName: "ask_user",
          reason: message,
        },
      };
    const planReview = this.options.planReviewWaiter?.pendingForRun(scope)[0];
    if (planReview)
      return {
        data: {
          toolCallId: planReview.providerToolCallId,
          toolName: "plan_mode_present",
          reason: message,
        },
      };
    const approval = this.options.approvalWaiter?.pendingForRun(scope)[0];
    if (approval)
      return {
        data: {
          toolCallId: approval.toolCallId,
          toolName: approval.toolName ?? approval.tool ?? "tool",
          reason: message,
        },
      };
    return undefined;
  }

  private async assertNoActiveForConversation(input: {
    conversationId?: string;
    agentId?: string;
  }): Promise<void> {
    if (!input.conversationId) return;
    for (const active of this.active.values()) {
      if (
        active.conversationId === input.conversationId &&
        (!input.agentId || active.agentId === input.agentId)
      ) {
        throw new Error(
          "INVALID_RUN_STATE: conversation already has active run",
        );
      }
    }
  }
}

function key(scope: {
  conversationId: string;
  agentId: string;
  runId: string;
}): string {
  return `${scope.conversationId}/${scope.agentId}/${scope.runId}`;
}

function normalizeError(error: unknown): {
  code: string;
  message: string;
  retryable: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.startsWith("UNAVAILABLE") ? "UNAVAILABLE" : "PROVIDER_FAILED",
    message: message.slice(0, 500),
    retryable: true,
  };
}
