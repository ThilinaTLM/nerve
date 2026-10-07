import {
  interruptAgent,
  type AgentInterruptionOptions,
} from "./workbench-agent-interruption.js";
import { waitForAgentRun, waitForRun } from "./workbench-agent-run-results.js";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createId } from "@nervekit/contracts";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import type { AgentRecord, PromptRequest } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import {
  AgentInputConflictError,
  type AgentInputRequest,
} from "../runtime/agent-inputs.js";
import { KeyedSerialLock } from "../runtime/run-locks.js";
import { TERMINAL_STATUSES, type RunCoordinator } from "../runtime/index.js";
import { ApplicationError } from "../../../core/application-error.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { WorkbenchRunUnitOfWork } from "../persistence/run-transition.repository.js";
import type {
  WorkbenchAgentControls,
  WorkbenchRunFeatureMechanics,
} from "./workbench-run.service.js";

/** Shared input/admission controls; no transport or orchestration-specific writers. */
export class WorkbenchAgentInputControls {
  private readonly agentAdmissions = new KeyedSerialLock();
  private readonly controlLocks = new KeyedSerialLock();
  private readonly pendingActivations = new Set<Promise<void>>();
  private readonly pendingInputWork = new Set<Promise<unknown>>();
  private readonly watcherShutdown = new AbortController();
  private readonly shutdownReason = new ApplicationError(
    503,
    "RUNTIME_SHUTTING_DOWN",
    "Runtime is shutting down.",
  );

  get admissionsStopped(): boolean {
    return this.watcherShutdown.signal.aborted;
  }
  /** Process-local fence only: do not pause or discard durable input. */
  stopAdmissions(): void {
    this.watcherShutdown.abort(this.shutdownReason);
  }
  async settledInputWork(): Promise<void> {
    // Drain work registered while unwinding; pollers abort without settling runs.
    while (this.pendingInputWork.size || this.pendingActivations.size) {
      await Promise.allSettled([
        ...this.pendingInputWork,
        ...this.pendingActivations,
      ]);
    }
  }
  private assertAdmissionsOpen(): void {
    if (this.admissionsStopped) throw this.shutdownReason;
  }
  async withInputWork<T>(action: () => Promise<T>): Promise<T> {
    this.assertAdmissionsOpen();
    return this.trackInputWork(action());
  }
  private trackInputWork<T>(operation: Promise<T>): Promise<T> {
    this.pendingInputWork.add(operation);
    const release = () => this.pendingInputWork.delete(operation);
    void operation.then(release, release);
    return operation;
  }
  private async waitForWatchedRun(runId: string) {
    const signal = this.watcherShutdown.signal;
    for (;;) {
      signal.throwIfAborted();
      const state = await this.unitOfWork.loadFresh(runId);
      signal.throwIfAborted();
      if (!state)
        throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
      if (
        TERMINAL_STATUSES.has(state.run.status) ||
        state.run.status === "interrupted"
      )
        return state;
      await delay(25, undefined, { signal, ref: false }).catch((error) => {
        signal.throwIfAborted();
        throw error;
      });
    }
  }
  private watchRun(agentId: string, runId: string): void {
    if (this.admissionsStopped) return;
    const operation = this.trackInputWork(
      (async () => {
        let state;
        try {
          state = await this.waitForWatchedRun(runId);
        } catch (error) {
          if (error === this.shutdownReason) return;
          throw error;
        }
        if (this.admissionsStopped || !TERMINAL_STATUSES.has(state.run.status))
          return;
        await this.controls!.inputs.settleRun(
          agentId,
          runId,
          this.controls?.hasAgentContextEntry
            ? (id) => this.controls!.hasAgentContextEntry!(agentId, id)
            : undefined,
        );
        if (!this.admissionsStopped)
          await this.facade.recoverAgentInputs(
            state.run.status === "failed" ? agentId : undefined,
          );
      })(),
    );
    void operation.catch((error) => {
      process.emitWarning(
        `Agent run ${runId} input settlement failed: ${String(error)}`,
      );
    });
  }
  constructor(
    private readonly state: RuntimeState,
    private readonly coordinator: RunCoordinator,
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
    private readonly features: WorkbenchRunFeatureMechanics,
    private readonly controls: WorkbenchAgentControls | undefined,
    private readonly facade: {
      wakeAgentFromHarness(agentId: string, explicit?: boolean): Promise<void>;
      abortAgent(
        agentId: string,
        onPaused?: (generation: number) => void,
      ): Promise<void>;
      recoverAgentInputs(excludeAgentId?: string): Promise<void>;
      getAgentHistory(agentId: string): Promise<ConversationEntry[]>;
    },
  ) {}
  withControl<T>(agentId: string, action: () => Promise<T>): Promise<T> {
    return this.controlLocks.exclusive(agentId, action);
  }
  async abortRun(input: {
    agentId?: string;
    runId?: string;
    reason?: string;
    onPaused?: (generation: number) => void;
  }): Promise<void> {
    const target = input.runId
      ? await this.unitOfWork.loadFresh(input.runId)
      : undefined;
    if (
      input.runId &&
      (!target || (input.agentId && target.run.agentId !== input.agentId))
    )
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    if (target && TERMINAL_STATUSES.has(target.run.status)) return;
    const agentId = input.agentId ?? target?.run.agentId;
    if (agentId) {
      this.requireAgent(agentId);
      const generation = await this.withControl(agentId, async () => {
        const pause = async () => {
          if (input.runId) {
            const current = await this.unitOfWork.loadFresh(input.runId);
            if (!current || TERMINAL_STATUSES.has(current.run.status))
              return { cancelled: false, generation: undefined };
          }
          const value = await this.controls?.inputs.setPaused(agentId, true);
          await this.controls?.setActivationState?.(agentId, "paused");
          if (value !== undefined) input.onPaused?.(value);
          return { cancelled: true, generation: value };
        };
        const fencedPause = () =>
          input.runId && this.coordinator.withRunControlFence
            ? this.coordinator.withRunControlFence(input.runId, pause)
            : pause();
        return this.coordinator.withAgentDispatchFence
          ? this.coordinator.withAgentDispatchFence(agentId, fencedPause)
          : fencedPause();
      });
      if (generation.cancelled)
        await this.cancelAgentRun(input, generation.generation);
    } else await this.cancelAgentRun(input);
  }
  private async cancelAgentRun(
    input: {
      agentId?: string;
      runId?: string;
      reason?: string;
    },
    generation?: number,
  ): Promise<void> {
    const agent = input.agentId ? this.requireAgent(input.agentId) : undefined;
    const state = input.runId
      ? await this.unitOfWork.load(input.runId)
      : agent
        ? await this.unitOfWork.findActive(this.scopeId(agent))
        : undefined;
    if (
      (input.runId && !state) ||
      (agent && state && state.run.agentId !== agent.id)
    )
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    const owner =
      agent ?? (state ? this.requireAgent(state.run.agentId) : undefined);
    if (input.runId && state && TERMINAL_STATUSES.has(state.run.status)) return;
    if (owner) {
      if (
        generation !== undefined &&
        (await this.controls?.inputs.controlGeneration(owner.id)) !== generation
      )
        return;
    }
    if (owner && !owner.parentAgentId) await this.features.stopTeam?.(owner.id);
    if (!state) return;
    await this.coordinator.cancel(
      state.run.runId,
      input.reason ?? "user requested abort",
    );
    // Cancellation leaves uncertain tool inspection issues visible.
  }

  withAdmission<T>(agentId: string, action: () => Promise<T>): Promise<T> {
    return this.trackInputWork(
      this.agentAdmissions.exclusive(agentId, async () => {
        this.assertAdmissionsOpen();
        return action();
      }),
    );
  }
  async migrateLegacyInputs(): Promise<void> {
    if (!this.controls) return;
    const states = this.unitOfWork.list
      ? await this.unitOfWork.list()
      : await this.unitOfWork.listActive();
    const pending = states
      .flatMap((state) =>
        state.prompts
          .filter((prompt) => ["queued", "accepted"].includes(prompt.status))
          .map((prompt) => ({ ...prompt, runId: state.run.runId })),
      )
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.ordinal - b.ordinal,
      );
    for (const prompt of pending) {
      this.requireAgent(prompt.agentId);
      await this.controls.inputs.accept(
        prompt.agentId,
        prompt.conversationId,
        {
          text: prompt.text,
          images: prompt.images,
          role: "user",
          // Preserve legacy content without inventing caller authority.
          origin: {
            kind: "system",
            producer: "recovery",
            correlationId: `legacy:${prompt.id}`,
          },
          idempotencyKey: `legacy:${prompt.id}`,
          eligibility:
            prompt.behavior === "follow-up"
              ? { kind: "next_run", afterRunId: prompt.runId }
              : { kind: "run", runId: prompt.runId },
          activation: "wake_if_idle",
        },
        async () => undefined,
      );
      await this.coordinator.cancelPrompt(prompt.runId, prompt.id);
    }
  }

  recoverAgentInputs(excludeAgentId?: string): Promise<void> {
    if (this.admissionsStopped) return Promise.resolve();
    return this.trackInputWork(this.performInputRecovery(excludeAgentId));
  }
  private async performInputRecovery(excludeAgentId?: string): Promise<void> {
    if (!this.controls) return;
    for (const agent of this.state.agents.values()) {
      if (this.admissionsStopped) return;
      if (agent.id === excludeAgentId) continue;
      try {
        if ((await this.controls.inputs.controlGeneration(agent.id)) > 0) {
          const activation = (await this.controls.inputs.isPaused(agent.id))
            ? "paused"
            : "enabled";
          if (agent.activationState !== activation)
            await this.controls.setActivationState?.(agent.id, activation);
        }
        for (const input of await this.controls.inputs.list(agent.id)) {
          if (input.eligibility.kind !== "run") continue;
          const targeted = await this.unitOfWork.loadFresh(
            input.eligibility.runId,
          );
          if (targeted && TERMINAL_STATUSES.has(targeted.run.status))
            await this.controls.inputs.settleRun(
              agent.id,
              targeted.run.runId,
              this.controls.hasAgentContextEntry
                ? (id) => this.controls!.hasAgentContextEntry!(agent.id, id)
                : undefined,
            );
        }
        const wakeRequested = await this.controls.inputs.hasWakeRequest(
          agent.id,
        );
        const contextPending = await this.controls.inputs.hasContextPending(
          agent.id,
        );
        if (
          contextPending ||
          (await this.controls.inputs.list(agent.id)).some(
            (input) =>
              input.eligibility.kind !== "run" &&
              (wakeRequested || input.activation === "wake_if_idle"),
          )
        )
          try {
            await this.facade.wakeAgentFromHarness(agent.id);
          } catch (error) {
            if (error === this.shutdownReason) return;
            await this.controls.inputs.recordAdmissionBlocker(
              agent.id,
              String(error),
            );
          }
      } catch (error) {
        if (error === this.shutdownReason) return;
        process.emitWarning(
          `Agent ${agent.id} input recovery blocked: ${String(error)}`,
        );
        await this.controls.inputs
          .recordAdmissionBlocker(agent.id, String(error))
          .catch(() => undefined);
      }
    }
  }
  async admitAgentRun(
    agent: AgentRecord,
    initialInputId?: string,
    signal?: AbortSignal,
    permitStoredContext = false,
  ) {
    this.assertAdmissionsOpen();
    const generation = await this.controls?.inputs.controlGeneration(agent.id);
    const policy = this.controls?.admissionPolicy;
    const runId = policy ? createId("run") : undefined;
    let committed = false;
    try {
      if (runId)
        await policy!.reserve({
          agentId: agent.id,
          runId,
          inputs: await this.controls!.inputs.list(agent.id),
        });
      const first = (await this.controls?.inputs.list(agent.id))?.find(
        (input) => input.eligibility.kind !== "run",
      );
      // CLI syntax requires user administration, not role or payload authority.
      const inline =
        first?.role === "user" &&
        first.origin.kind === "user" &&
        parseInlineCommandPrompt(first.text);
      const command = {
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        scopeId: this.scopeId(agent),
        ...(this.controls
          ? {
              assertAdmission: async () => {
                this.assertAdmissionsOpen();
                if (signal?.aborted)
                  throw (
                    signal.reason ??
                    new Error("Assignment cancelled before admission")
                  );
                if (
                  initialInputId &&
                  (await this.controls!.inputs.get(agent.id, initialInputId))
                    ?.state !== "pending"
                )
                  throw new ApplicationError(
                    409,
                    "AGENT_INPUT_CANCELLED",
                    "Assignment input is no longer pending.",
                  );
                if (
                  !permitStoredContext &&
                  !(await this.controls!.inputs.hasContextPending(agent.id)) &&
                  !(await this.controls!.inputs.list(agent.id)).some(
                    (input) => input.eligibility.kind !== "run",
                  )
                )
                  throw new ApplicationError(
                    409,
                    "AGENT_INPUT_UNAVAILABLE",
                    "No eligible input remains before admission.",
                  );
                if (
                  this.requireAgent(agent.id).activationState === "paused" ||
                  (await this.controls!.inputs.isPaused(agent.id))
                )
                  throw new ApplicationError(
                    409,
                    "AGENT_ADMISSION_PAUSED",
                    "Agent activation was paused before admission.",
                  );
              },
            }
          : {}),
        ...(runId ? { runId } : {}),
        ...((initialInputId ?? first?.id)
          ? {
              initialInputId: inline ? first.id : (initialInputId ?? first!.id),
            }
          : {}),
      };
      await this.controls?.inputs.recordAdmissionBlocker(agent.id);
      const run = inline
        ? await this.coordinator.start({
            ...command,
            prompt: first.text,
            images: first.images,
          })
        : await this.coordinator.startContinuation(command);
      committed = true;
      if (runId) await policy!.committed({ agentId: agent.id, runId });
      if (generation !== undefined)
        await this.controls?.inputs.consumeWakeRequest(agent.id, generation);
      if (this.controls) this.watchRun(agent.id, run.runId);
      return run;
    } catch (error) {
      if (error !== this.shutdownReason)
        await this.controls?.inputs.recordAdmissionBlocker(
          agent.id,
          String(error),
        );
      if (runId && !committed) {
        if (await this.unitOfWork.loadFresh(runId))
          await policy!.committed({ agentId: agent.id, runId });
        else await policy!.released({ agentId: agent.id, runId });
      }
      throw error;
    }
  }
  async enqueueAgentInput(
    agentId: string,
    request: AgentInputRequest,
    options: {
      activate?: boolean;
      expectedGeneration?: number;
      onAccepted?: (
        input: import("@nervekit/contracts/agents").AgentInputRecord,
      ) => void;
    } = {},
  ) {
    const agent = this.requireAgent(agentId);
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
    if (!this.controls)
      throw new Error("Durable agent input service is not configured");
    const input = await this.controls.inputs.accept(
      agent.id,
      agent.conversationId,
      request,
      async () => {
        const target = request.eligibility;
        const runId =
          target.kind === "run"
            ? target.runId
            : target.kind === "next_run"
              ? target.afterRunId
              : undefined;
        if (!runId) return;
        const state = await this.unitOfWork.loadFresh(runId);
        if (
          !state ||
          state.run.agentId !== agentId ||
          (target.kind === "run" && TERMINAL_STATUSES.has(state.run.status))
        ) {
          throw new ApplicationError(
            409,
            "INVALID_INPUT_TARGET",
            "Input target is not an eligible run of this agent.",
          );
        }
      },
      options.expectedGeneration,
    );
    options.onAccepted?.(input);
    try {
      await this.controls.inputAccepted?.(input);
    } catch (error) {
      process.emitWarning(
        `Agent input accepted but observer failed: ${String(error)}`,
      );
    }
    if (options.activate === false || this.admissionsStopped) return input;
    const activation = this.activateAcceptedInput(agent, request, input);
    this.trackActivation(activation);
    return input;
  }
  private trackActivation(operation: Promise<void>): void {
    this.pendingActivations.add(operation);
    void operation.then(
      () => this.pendingActivations.delete(operation),
      (error) => {
        this.pendingActivations.delete(operation);
        if (error !== this.shutdownReason)
          process.emitWarning(
            `Accepted input activation failed: ${String(error)}`,
          );
      },
    );
  }
  async settledAdmissions(): Promise<void> {
    await Promise.allSettled([...this.pendingActivations]);
  }
  private async tryWakeAgent(agentId: string): Promise<boolean> {
    try {
      await this.facade.wakeAgentFromHarness(agentId);
      return true;
    } catch (error) {
      if (error !== this.shutdownReason)
        process.emitWarning(
          `Agent input remains pending; admission blocked: ${String(error)}`,
        );
      return false;
    }
  }
  private async activateAcceptedInput(
    agent: AgentRecord,
    request: AgentInputRequest,
    input: import("@nervekit/contracts/agents").AgentInputRecord,
  ): Promise<void> {
    if (this.admissionsStopped) return;
    const agentId = agent.id;
    const wakeRequested =
      request.activation === "wake_if_idle" && input.state === "pending";
    const wakeFailed = wakeRequested && !(await this.tryWakeAgent(agentId));
    if (this.admissionsStopped) return;
    const active =
      request.eligibility.kind === "run"
        ? await this.unitOfWork.loadFresh(request.eligibility.runId)
        : await this.unitOfWork.findActive(this.scopeId(agent));
    if (!active && !wakeFailed && wakeRequested)
      await this.tryWakeAgent(agentId);
    if (active && input.state === "pending") {
      // Settlement preserves general input; targeted input is never retargeted.
      this.watchRun(agentId, active.run.runId);
    }
  }
  async submitAgentRun(
    agentId: string,
    text: string,
    parent?: { agentId: string; runId?: string },
    options: { signal?: AbortSignal; idempotencyKey?: string } = {},
  ): Promise<{ agentId: string; runId: string; attemptId: string }> {
    if (!this.controls)
      throw new Error("Durable inputs are required for submitted assignments");
    options.signal?.throwIfAborted();
    let onAbort: (() => void) | undefined;
    let cancellation: Promise<void> | undefined;
    try {
      const accepted = await this.enqueueAgentInput(
        agentId,
        {
          text,
          role: "user",
          origin: parent
            ? { kind: "parent", agentId: parent.agentId, runId: parent.runId }
            : { kind: "user", userId: "authorized-user" },
          idempotencyKey: options.idempotencyKey ?? randomUUID(),
          eligibility: { kind: "next_turn" },
          activation: "wake_if_idle",
        },
        {
          activate: false,
          onAccepted: (input) => {
            onAbort = () => {
              if (this.admissionsStopped || cancellation) return;
              cancellation = this.trackInputWork(
                this.cancelAcceptedSubmission(agentId, input.id),
              );
              void cancellation.catch(() => undefined);
            };
            options.signal?.addEventListener("abort", onAbort, { once: true });
            if (options.signal?.aborted) onAbort();
          },
        },
      );
      for (;;) {
        this.assertAdmissionsOpen();
        const currentReceipt = await this.controls.inputs.get(
          agentId,
          accepted.id,
        );
        this.assertAdmissionsOpen();
        const states = this.unitOfWork.list
          ? await this.unitOfWork.list()
          : await this.unitOfWork.listActive();
        const bound = states.find(
          (state) =>
            state.run.initialInputId === accepted.id ||
            state.run.runId === currentReceipt?.delivery?.runId,
        );
        if (options.signal?.aborted) {
          onAbort?.();
          throw options.signal.reason ?? new Error("Assignment cancelled");
        }
        if (bound)
          return {
            agentId,
            runId: bound.run.runId,
            attemptId:
              currentReceipt?.delivery?.attemptId ??
              (await this.unitOfWork.loadFresh(bound.run.runId))
                ?.transitions?.[0]?.run.executionId ??
              bound.run.executionId,
          };
        if (
          !currentReceipt ||
          currentReceipt.state === "cancelled" ||
          currentReceipt.state === "obsolete"
        )
          throw new ApplicationError(
            409,
            "AGENT_INPUT_CANCELLED",
            "Assignment was cancelled before admission.",
          );
        let run;
        try {
          run = await this.withAdmission(agentId, async () => {
            const agent = this.requireAgent(agentId);
            if (
              agent.activationState === "paused" ||
              (await this.controls!.inputs.isPaused(agentId))
            )
              return undefined;
            const active = await this.unitOfWork.findActive(
              this.scopeId(agent),
            );
            if (active) return undefined;
            const current = await this.controls!.inputs.get(
              agentId,
              accepted.id,
            );
            if (current?.state !== "pending") return undefined;
            return this.admitAgentRun(agent, accepted.id, options.signal);
          });
        } catch (error) {
          if (options.signal?.aborted) {
            onAbort?.();
            throw options.signal.reason ?? error;
          }
          if (
            !(
              error instanceof ApplicationError &&
              error.code === "SUBAGENT_CAPACITY"
            )
          )
            throw error;
        }
        if (run && run.initialInputId === accepted.id)
          return { agentId, runId: run.runId, attemptId: run.executionId };
        // Wait outside control/admission locks; preserve the accepted identity.
        await delay(25, undefined, {
          signal: options.signal
            ? AbortSignal.any([this.watcherShutdown.signal, options.signal])
            : this.watcherShutdown.signal,
        }).catch((error) => {
          this.assertAdmissionsOpen();
          if (options.signal?.aborted) throw options.signal.reason ?? error;
          throw error;
        });
      }
    } finally {
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
      await cancellation;
    }
  }
  private async cancelAcceptedSubmission(
    agentId: string,
    inputId: string,
  ): Promise<void> {
    if (!this.controls) return;
    // Fence admission commit; cancel only this input/run, never pause the agent.
    const bound = await this.agentAdmissions.exclusive(agentId, async () => {
      await this.controls!.inputs.cancel(agentId, inputId).catch((error) => {
        if (!(error instanceof AgentInputConflictError)) throw error;
      });
      const receipt = await this.controls!.inputs.get(agentId, inputId);
      const states = this.unitOfWork.list
        ? await this.unitOfWork.list()
        : await this.unitOfWork.listActive();
      return states.find(
        (state) =>
          state.run.initialInputId === inputId ||
          state.run.runId === receipt?.delivery?.runId,
      );
    });
    if (bound) {
      await this.coordinator.cancel(bound.run.runId, "Assignment cancelled");
      await waitForRun(this.unitOfWork, bound.run.runId);
    }
  }
  waitForAgentRun(
    identity: { agentId: string; runId: string; attemptId: string },
    signal?: AbortSignal,
  ) {
    return waitForAgentRun(
      this.unitOfWork,
      this.controls,
      (id) => this.facade.getAgentHistory(id),
      identity,
      signal,
    );
  }
  async resumeAgent(
    agentId: string,
    onResumed?: (generation: number) => void,
    options?: { authority: "user_administration" },
  ): Promise<void> {
    this.requireAgent(agentId);
    const generation = await this.withControl(agentId, async () => {
      const value = await this.controls?.inputs.setPaused(agentId, false, true);
      await this.controls?.setActivationState?.(agentId, "enabled");
      await this.features.reopenTeam?.(agentId);
      if (value !== undefined && options?.authority === "user_administration")
        await this.controls?.admissionPolicy?.recordAdministrativeActivation?.({
          agentId,
          generation: value,
          cause: "user_resume",
          runId: (
            await this.unitOfWork.findActive(
              this.scopeId(this.requireAgent(agentId)),
            )
          )?.run.runId,
        });
      if (value !== undefined) onResumed?.(value);
      return value;
    });
    const active = await this.unitOfWork.findActive(
      this.scopeId(this.requireAgent(agentId)),
    );
    if (active && ["suspended", "interrupted"].includes(active.run.status)) {
      await this.withAdmission(agentId, async () => {
        if (
          generation !== undefined &&
          (await this.controls?.inputs.controlGeneration(agentId)) !==
            generation
        )
          return;
        await this.coordinator.scheduleContinuation(active.run.runId);
      });
    } else if (
      active ||
      (await this.controls?.inputs.list(agentId))?.length ||
      (await this.controls?.inputs.hasContextPending(agentId))
    ) {
      const activation = this.facade.wakeAgentFromHarness(agentId, true);
      this.trackActivation(activation);
    }
  }
  async interruptAgent(
    agentId: string,
    request: PromptRequest,
    options?: AgentInterruptionOptions,
  ): Promise<void> {
    if (!this.controls)
      throw new Error("Durable controls are required for interruption");
    await interruptAgent(
      {
        controls: this.controls,
        coordinator: this.coordinator,
        features: this.features,
        getAgent: (id) => this.requireAgent(id),
        withControl: (id, action) => this.withControl(id, action),
        abortAgent: (id, onPaused) => this.facade.abortAgent(id, onPaused),
        activate: (input) => {
          const activation = this.activateAcceptedInput(
            this.requireAgent(agentId),
            input,
            input,
          );
          this.trackActivation(activation);
        },
      },
      agentId,
      request,
      options,
    );
  }
  private requireAgent(agentId: string): AgentRecord {
    const agent = this.state.agents.get(agentId);
    if (!agent)
      throw new ApplicationError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }
  private scopeId(agent: AgentRecord): string {
    return `${agent.conversationId}:${agent.id}`;
  }
}
