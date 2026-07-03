import { type AgentHarness, isAgentToolSuspension } from "@nervekit/agent";
import type { SandboxConfigV1 } from "@nervekit/shared";
import { resolveModelSelection } from "../models/model-catalog.js";
import type { ApprovalWaiter } from "../tools/approval-waiter.js";
import type { InputWaiter } from "../tools/input-waiter.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
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
  approvalWaiter?: ApprovalWaiter;
  toolRuntime?: SandboxToolRuntime;
  exploreRuntime?: ExploreRuntime;
};

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

  describe(): Record<string, unknown> {
    return {
      mainModel: resolveModelSelection(
        this.config,
        this.config.agent.mainModel,
      ),
      harness: this.options.harnessFactory?.describe(
        "conv_status",
        "agent_main",
      ),
      mode: this.config.agent.mode ?? "normal",
      activeRuns: this.active.size,
    };
  }

  async startRun(
    input: Parameters<RunManager["createRun"]>[0],
  ): Promise<RunState> {
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    if (!this.options.harnessFactory) return this.options.runs.start(input);
    await this.options.harnessFactory.assertModelAvailable();
    const behavior = input.behavior ?? "start";
    if (behavior === "follow_up")
      await this.assertNoActiveForConversation(input);
    const { run, executionId } = await this.options.runs.createRun(input);
    this.launch(run, executionId, input.prompt ?? "", "prompt");
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
      const pending = this.options.inputWaiter?.pendingForRun(scope) ?? [];
      if (pending.length)
        throw new Error("INVALID_RUN_STATE: input wait is not resolved");
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
    await active.harness.steer(text, { id: `steer_${Date.now()}` });
  }

  async cancelRun(scope: RunScope & { reason?: string }): Promise<RunState> {
    const active = this.active.get(key(scope));
    if (active) active.cancelling = true;
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    await this.options.toolRuntime?.cancelRun(scope);
    await this.options.exploreRuntime?.cancelRun(scope);
    active?.abortController.abort();
    await active?.harness?.abort().catch(() => undefined);
    await active?.promise.catch(() => undefined);
    this.active.delete(key(scope));
    await this.options.inputWaiter?.cancelRun(scope);
    await this.options.approvalWaiter?.cancelRun(scope);
    return this.options.runs.cancel({
      ...scope,
      executionId: active?.executionId,
    });
  }

  async recoverActiveRuns(): Promise<void> {
    this.active.clear();
    if (!this.options.runs) return;
    for (const run of await this.options.runs.list()) {
      if (run.status === "running" || run.status === "streaming") {
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
    const promise = (async () => {
      let dispose: (() => void) | undefined;
      try {
        const harness = await harnessFactory.create(scope);
        active.harness = harness;
        dispose = this.options.bridge?.attach(harness, scope);
        const model = this.config.agent.mainModel;
        await runs.markRunning(scope, {
          provider: model.provider,
          model: model.model,
          thinkingLevel: model.thinkingLevel,
        });
        if (mode === "continue") await harness.continue();
        else await harness.prompt(prompt);
        if (active.abortController.signal.aborted || active.cancelling) return;
        await runs.markCompleted(scope);
      } catch (error) {
        if (isAgentToolSuspension(error)) {
          await this.options.bridge?.handleSuspension(scope, error);
          return;
        }
        const pendingSuspension = this.pendingSuspension(scope, error);
        if (pendingSuspension) {
          await this.options.bridge?.handleSuspension(scope, pendingSuspension);
          return;
        }
        if (active.abortController.signal.aborted || active.cancelling) {
          return;
        }
        await runs.markFailed(scope, normalizeError(error), true);
      } finally {
        dispose?.();
        this.active.delete(key(scope));
      }
    })();
    active.promise = promise;
  }

  private pendingSuspension(
    scope: RunScope,
    error: unknown,
  ):
    | { data: { toolCallId: string; toolName: string; reason: string } }
    | undefined {
    const message = error instanceof Error ? error.message : String(error);
    if (!/WAITING_FOR_(INPUT|APPROVAL)/.test(message)) return undefined;
    const input = this.options.inputWaiter?.pendingForRun(scope)[0];
    if (input)
      return {
        data: {
          toolCallId: input.requestId,
          toolName: "ask_user",
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
