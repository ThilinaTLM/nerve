import { KeyedSerialLock } from "./run-locks.js";

export type { AgentInput } from "@nervekit/contracts/agents";
import {
  acceptAgentInputRequestSchema,
  type AgentInput,
  type AcceptAgentInputRequest,
} from "@nervekit/contracts/agents";
import type { IdPort } from "../../../core/ports/ids.js";
import type { ClockPort } from "../../../core/ports/clock.js";
export type AgentInputRequest = Omit<
  AcceptAgentInputRequest,
  "agentId" | "conversationId"
>;
export type {
  AgentInputQueueState,
  AgentInputTarget,
} from "@nervekit/contracts/agents";
import type {
  AgentInputQueueState,
  AgentInputTarget,
} from "@nervekit/contracts/agents";
export interface AgentInputStore {
  load(agentId: string): Promise<AgentInputQueueState | undefined>;
  save(
    agentId: string,
    state: AgentInputQueueState,
    expectedRevision: number,
  ): Promise<void>;
}
export class AgentInputConflictError extends Error {}
export class AgentControlGenerationConflictError extends AgentInputConflictError {}

export function agentInputContextEntryId(inputId: string): string {
  return `entry_${inputId}`;
}

/** Sole durable input writer. Live queues are not acceptance authorities. */
export class AgentInputService {
  private readonly locks = new KeyedSerialLock();
  constructor(
    private readonly store: AgentInputStore,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
  ) {}

  private async load(agentId: string): Promise<AgentInputQueueState> {
    return (
      (await this.store.load(agentId)) ?? {
        revision: 0,
        nextSequence: 0,
        paused: false,
        inputs: [],
      }
    );
  }
  private async save(
    agentId: string,
    state: AgentInputQueueState,
  ): Promise<void> {
    await this.store.save(
      agentId,
      { ...state, revision: state.revision + 1 },
      state.revision,
    );
  }
  async accept(
    agentId: string,
    conversationId: string,
    request: AgentInputRequest,
    validateTarget: () => Promise<void>,
    expectedGeneration?: number,
    resumeControl = false,
  ): Promise<AgentInput> {
    return this.locks.exclusive(agentId, async () => {
      request = acceptAgentInputRequestSchema.parse({
        ...request,
        agentId,
        conversationId,
      });
      const state = await this.load(agentId);
      if (
        expectedGeneration !== undefined &&
        (state.controlGeneration ?? 0) !== expectedGeneration
      )
        throw new AgentControlGenerationConflictError(
          "Control intent was superseded before input acceptance",
        );
      const existing = state.inputs.find(
        (input) => input.idempotencyKey === request.idempotencyKey,
      );
      if (existing) {
        if (
          JSON.stringify(
            acceptAgentInputRequestSchema.parse({
              ...existing,
              eligibility:
                state.acceptedEligibilities?.[existing.id] ??
                existing.eligibility,
            }),
          ) !== JSON.stringify(request)
        ) {
          throw new Error(
            "Input idempotency key reused with different content",
          );
        }
        return existing;
      }
      if (!request.idempotencyKey || !request.text.trim())
        throw new Error("Input requires content and idempotency key");
      if (request.role === "system" && request.origin.kind !== "system")
        throw new Error("System input requires authenticated system origin");
      await validateTarget();
      if (resumeControl) {
        if (expectedGeneration === undefined)
          throw new AgentInputConflictError(
            "Resume acceptance requires a control generation",
          );
        state.paused = false;
        state.controlGeneration = expectedGeneration + 1;
      }
      const input: AgentInput = {
        ...structuredClone(request),
        id: `input_${this.ids.next()}`,
        agentId,
        conversationId,
        sequence: state.nextSequence++,
        acceptedAt: this.clock.now().toISOString(),
        state: "pending",
      };
      state.inputs.push(input);
      state.acceptedEligibilities ??= {};
      state.acceptedEligibilities[input.id] = structuredClone(
        input.eligibility,
      );
      await this.save(agentId, state);
      return input;
    });
  }
  async acceptanceForKey(
    agentId: string,
    key: string,
  ): Promise<AgentInput | undefined> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      const input = state.inputs.find((input) => input.idempotencyKey === key);
      return input
        ? {
            ...input,
            eligibility:
              state.acceptedEligibilities?.[input.id] ?? input.eligibility,
          }
        : undefined;
    });
  }
  async get(agentId: string, inputId: string): Promise<AgentInput | undefined> {
    return this.locks.exclusive(agentId, async () =>
      (await this.load(agentId)).inputs.find((input) => input.id === inputId),
    );
  }
  async requestWake(agentId: string): Promise<void> {
    await this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      if (
        !state.paused &&
        state.inputs.some(
          (input) =>
            input.state === "pending" && input.eligibility.kind !== "run",
        )
      ) {
        state.wakeRequested = true;
        await this.save(agentId, state);
      }
    });
  }
  async list(agentId: string): Promise<AgentInput[]> {
    return this.locks.exclusive(agentId, async () =>
      (await this.load(agentId)).inputs.filter(
        (input) => input.state === "pending",
      ),
    );
  }
  async isPaused(agentId: string): Promise<boolean> {
    return this.locks.exclusive(
      agentId,
      async () => (await this.load(agentId)).paused,
    );
  }
  async setPaused(
    agentId: string,
    paused: boolean,
    requestWake = false,
  ): Promise<number> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      state.paused = paused;
      state.wakeRequested =
        !paused &&
        requestWake &&
        (Boolean(state.contextPending) ||
          state.inputs.some(
            (input) =>
              input.state === "pending" && input.eligibility.kind !== "run",
          ));
      state.controlGeneration = (state.controlGeneration ?? 0) + 1;
      await this.save(agentId, state);
      return state.controlGeneration;
    });
  }
  async captureCut<T>(
    agentId: string,
    readCommitted: () => Promise<T>,
  ): Promise<{ actor: T; generation: number; cutoffSequence: number }> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      const actor = await readCommitted();
      return {
        actor: structuredClone(actor),
        generation: state.controlGeneration ?? 0,
        cutoffSequence: state.nextSequence - 1,
      };
    });
  }
  async hasContextPending(agentId: string): Promise<boolean> {
    return this.locks.exclusive(agentId, async () =>
      Boolean((await this.load(agentId)).contextPending),
    );
  }
  async recordProviderDispatch(agentId: string): Promise<void> {
    await this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      if (state.contextPending) {
        state.contextPending = false;
        if (
          !state.inputs.some(
            (input) =>
              input.state === "pending" && input.eligibility.kind !== "run",
          )
        )
          state.wakeRequested = false;
        await this.save(agentId, state);
      }
    });
  }
  async hasWakeRequest(agentId: string): Promise<boolean> {
    return this.locks.exclusive(agentId, async () =>
      Boolean((await this.load(agentId)).wakeRequested),
    );
  }
  async consumeWakeRequest(agentId: string, generation: number): Promise<void> {
    await this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      if (
        state.wakeRequested &&
        (state.controlGeneration ?? 0) === generation
      ) {
        state.wakeRequested = false;
        await this.save(agentId, state);
      }
    });
  }
  async recordAdmissionBlocker(
    agentId: string,
    message?: string,
    configurationRevision?: number,
  ): Promise<void> {
    await this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      if (
        state.admissionBlocker?.message === message &&
        state.admissionBlocker?.configurationRevision === configurationRevision
      )
        return;
      state.admissionBlocker = message
        ? {
            message,
            recordedAt: this.clock.now().toISOString(),
            configurationRevision,
          }
        : undefined;
      await this.save(agentId, state);
    });
  }
  async admissionBlocker(
    agentId: string,
  ): Promise<
    | { message: string; recordedAt: string; configurationRevision?: number }
    | undefined
  > {
    return this.locks.exclusive(
      agentId,
      async () => (await this.load(agentId)).admissionBlocker,
    );
  }
  async controlGeneration(agentId: string): Promise<number> {
    return this.locks.exclusive(
      agentId,
      async () => (await this.load(agentId)).controlGeneration ?? 0,
    );
  }
  async resumeIfGeneration(
    agentId: string,
    generation: number,
  ): Promise<boolean> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      if ((state.controlGeneration ?? 0) !== generation) return false;
      state.paused = false;
      state.controlGeneration = generation + 1;
      await this.save(agentId, state);
      return true;
    });
  }
  async cancel(agentId: string, inputId: string): Promise<AgentInput> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      const input = state.inputs.find((item) => item.id === inputId);
      if (
        !input ||
        input.state !== "pending" ||
        state.insertionClaims?.[inputId]
      )
        throw new AgentInputConflictError(
          "Pending input not found or delivery already claimed",
        );
      input.state = "cancelled";
      if (
        !state.inputs.some(
          (item) => item.state === "pending" && item.eligibility.kind !== "run",
        )
      )
        state.wakeRequested = false;
      await this.save(agentId, state);
      return input;
    });
  }
  /** Insertion runs under the same fence as cancellation. Stable IDs recover a crash after insertion but before recording delivery. */
  async prepare(
    target: AgentInputTarget,
    insert: (
      input: AgentInput,
      contextEntryId: string,
      insertionTarget: AgentInputTarget,
    ) => Promise<void>,
    isRunTerminal: (runId: string) => Promise<boolean>,
    limit = 32,
    wasInserted?: (contextEntryId: string) => Promise<boolean>,
    onlyInputId?: string,
    validateBeforeClaim?: (input: AgentInput) => Promise<void>,
    cutoffSequence = Number.MAX_SAFE_INTEGER,
  ): Promise<AgentInput[]> {
    return this.locks.exclusive(target.agentId, async () => {
      const state = await this.load(target.agentId);
      if (state.paused) return [];
      const delivered: AgentInput[] = [];
      let dirty = false;
      for (const input of state.inputs) {
        if (
          input.agentId !== target.agentId ||
          input.conversationId !== target.conversationId
        )
          throw new Error(
            "Input context scope does not match its agent execution",
          );
        if (
          input.state !== "pending" ||
          input.sequence > cutoffSequence ||
          (onlyInputId && input.id !== onlyInputId)
        )
          continue;
        const previousClaim = state.insertionClaims?.[input.id];
        if (
          previousClaim &&
          wasInserted &&
          (previousClaim.runId !== target.runId ||
            previousClaim.attemptId !== target.attemptId ||
            previousClaim.turnId !== target.turnId ||
            (await isRunTerminal(previousClaim.runId)))
        ) {
          if (await wasInserted(agentInputContextEntryId(input.id))) {
            // Repair an insertion whose run settled before its delivery marker
            // committed. It remains historical input of that exact run.
            await insert(
              input,
              agentInputContextEntryId(input.id),
              previousClaim,
            );
            input.state = "delivered";
            if (previousClaim.requiresProvider !== false)
              state.contextPending = true;
            input.delivery = {
              ...previousClaim,
              contextEntryId: agentInputContextEntryId(input.id),
              deliveredAt: this.clock.now().toISOString(),
            };
            delete state.insertionClaims![input.id];
            await this.save(target.agentId, state);
            state.revision++;
            continue;
          }
          delete state.insertionClaims![input.id];
          dirty = true;
        }
        if (
          input.eligibility.kind === "run" &&
          input.eligibility.runId !== target.runId
        ) {
          if (await isRunTerminal(input.eligibility.runId)) {
            input.state = "obsolete";
            dirty = true;
          }
          continue;
        }
        if (
          input.eligibility.kind === "next_run" &&
          input.eligibility.afterRunId &&
          (input.eligibility.afterRunId === target.runId ||
            !(await isRunTerminal(input.eligibility.afterRunId)))
        )
          continue;
        if (delivered.length >= limit) break;
        await validateBeforeClaim?.(input);
        const contextEntryId = agentInputContextEntryId(input.id);
        state.insertionClaims ??= {};
        if (!state.insertionClaims[input.id]) {
          state.insertionClaims[input.id] = target;
          await this.save(target.agentId, state);
          state.revision++;
        }
        await insert(input, contextEntryId, state.insertionClaims[input.id]);
        input.state = "delivered";
        const claim = state.insertionClaims[input.id];
        if (claim.requiresProvider !== false) state.contextPending = true;
        input.delivery = {
          runId: claim.runId,
          attemptId: claim.attemptId,
          turnId: claim.turnId,
          contextEntryId,
          deliveredAt: this.clock.now().toISOString(),
        };
        delete state.insertionClaims[input.id];
        delivered.push(input);
        // Acknowledge each successful insertion separately, limiting crash replay.
        await this.save(target.agentId, state);
        state.revision++;
        dirty = false;
      }
      if (
        state.wakeRequested &&
        !state.inputs.some(
          (item) => item.state === "pending" && item.eligibility.kind !== "run",
        )
      ) {
        state.wakeRequested = false;
        dirty = true;
      }
      if (dirty) await this.save(target.agentId, state);
      return delivered;
    });
  }
  async promote(agentId: string): Promise<AgentInput[]> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      const pending = state.inputs.filter(
        (input) =>
          input.state === "pending" && !state.insertionClaims?.[input.id],
      );
      for (const input of pending)
        if (input.eligibility.kind === "next_run") {
          state.acceptedEligibilities ??= {};
          state.acceptedEligibilities[input.id] ??= structuredClone(
            input.eligibility,
          );
          input.eligibility = { kind: "next_turn" };
        }
      if (pending.length) await this.save(agentId, state);
      return pending;
    });
  }

  async bindTurn(
    agentId: string,
    preparedTurnId: string,
    turnId: string,
  ): Promise<void> {
    await this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      let dirty = false;
      for (const input of state.inputs) {
        if (input.delivery?.turnId === preparedTurnId) {
          input.delivery.turnId = turnId;
          dirty = true;
        }
      }
      if (dirty) await this.save(agentId, state);
    });
  }

  async settleRun(
    agentId: string,
    runId: string,
    wasInserted?: (entryId: string) => Promise<boolean>,
  ): Promise<void> {
    await this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      let dirty = false;
      for (const input of state.inputs) {
        if (
          input.state === "pending" &&
          input.eligibility.kind === "run" &&
          input.eligibility.runId === runId
        ) {
          const claim = state.insertionClaims?.[input.id];
          if (claim && !wasInserted)
            throw new Error(
              "Canonical context probe required to reconcile terminal input claim",
            );
          if (
            claim &&
            (await wasInserted!(agentInputContextEntryId(input.id)))
          ) {
            input.state = "delivered";
            input.delivery = {
              runId: claim.runId,
              attemptId: claim.attemptId,
              turnId: claim.turnId,
              contextEntryId: agentInputContextEntryId(input.id),
              deliveredAt: this.clock.now().toISOString(),
            };
            if (claim.requiresProvider !== false) state.contextPending = true;
          } else input.state = "obsolete";
          if (claim) delete state.insertionClaims![input.id];
          dirty = true;
        }
      }
      if (dirty) await this.save(agentId, state);
    });
  }

  /** Serialize final settlement checks with acceptance; general inputs remain durable if settlement wins. */
  async hasEligible(agentId: string, runId: string): Promise<boolean> {
    return this.locks.exclusive(agentId, async () => {
      const state = await this.load(agentId);
      return (
        !state.paused &&
        state.inputs.some(
          (input) =>
            input.state === "pending" &&
            (input.eligibility.kind === "next_turn" ||
              (input.eligibility.kind === "run" &&
                input.eligibility.runId === runId)),
        )
      );
    });
  }
}
