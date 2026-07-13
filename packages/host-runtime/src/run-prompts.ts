import type { PromptImage, RunPromptRecord } from "@nervekit/contracts";
import type { IdPort } from "./index.js";
import { InvalidRunStateError } from "./run-errors.js";
import type { RunEventFactory } from "./run-events.js";
import type { RunExecution } from "./run-execution.js";
import {
  ACTIVE_STATUSES,
  prefixed,
  revise,
  type TransitionChanges,
} from "./run-transitions.js";
import type { RunHydratedState } from "./run-unit-of-work.js";

export interface RunPromptCoordinatorPorts {
  ids: IdPort;
  events: RunEventFactory;
  now(): string;
  load(runId: string): Promise<RunHydratedState>;
  live(runId: string): RunExecution | undefined;
  exclusive<T>(key: string, action: () => Promise<T>): Promise<T>;
  commit(
    previous: RunHydratedState,
    run: RunHydratedState["run"],
    kind: string,
    changes?: TransitionChanges,
  ): Promise<void>;
}

export class RunPromptCoordinator {
  constructor(private readonly ports: RunPromptCoordinatorPorts) {}

  async queue(
    runId: string,
    behavior: "steer" | "follow-up",
    text: string,
    images?: readonly PromptImage[],
  ): Promise<RunPromptRecord> {
    const prompt = await this.ports.exclusive(`run:${runId}`, async () => {
      const state = await this.ports.load(runId);
      if (!ACTIVE_STATUSES.has(state.run.status)) {
        throw invalidPromptState(state, behavior);
      }
      const now = this.ports.now();
      const record: RunPromptRecord = {
        id: prefixed("promptq", this.ports.ids.next()),
        agentId: state.run.agentId,
        conversationId: state.run.conversationId,
        projectId: state.run.projectId,
        runId,
        behavior,
        text,
        images: images?.map((image) => ({ ...image })),
        status: "queued",
        ordinal: state.prompts.length,
        deliveryAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      const next = revise(state.run, {}, now);
      await this.ports.commit(state, next, "prompt_queued", {
        prompts: [record],
        events: [this.ports.events.queuedPrompt(next, record)],
      });
      return record;
    });
    const execution = this.ports.live(runId);
    if (execution) await this.drain(runId, execution);
    return prompt;
  }

  async cancel(runId: string, promptId: string): Promise<RunPromptRecord> {
    return this.ports.exclusive(`run:${runId}`, async () => {
      const state = await this.ports.load(runId);
      const prompt = state.prompts.find((item) => item.id === promptId);
      if (!prompt || !["queued", "accepted"].includes(prompt.status)) {
        throw new InvalidRunStateError("Queued prompt was not found");
      }
      const now = this.ports.now();
      const cancelled: RunPromptRecord = {
        ...prompt,
        status: "cancelled",
        updatedAt: now,
      };
      const next = revise(state.run, {}, now);
      await this.ports.commit(state, next, "prompt_cancelled", {
        prompts: [cancelled],
        events: [this.ports.events.cancelledPrompt(next, cancelled)],
      });
      return cancelled;
    });
  }

  async drain(runId: string, execution: RunExecution): Promise<void> {
    const initial = await this.ports.load(runId);
    for (const prompt of initial.prompts.filter(
      (item) => item.status === "queued",
    )) {
      try {
        if (prompt.behavior === "steer") await execution.control.steer(prompt);
        else await execution.control.followUp(prompt);
        await this.markDelivered(runId, prompt);
      } catch (error) {
        await this.markFailed(runId, prompt, error);
        throw error;
      }
    }
  }

  private async markDelivered(
    runId: string,
    prompt: RunPromptRecord,
  ): Promise<void> {
    await this.ports.exclusive(`run:${runId}`, async () => {
      const current = await this.ports.load(runId);
      const persisted = current.prompts.find((item) => item.id === prompt.id);
      if (!persisted || persisted.status !== "queued") return;
      const now = this.ports.now();
      const delivered: RunPromptRecord = {
        ...persisted,
        status: "delivered",
        deliveryAttempts: persisted.deliveryAttempts + 1,
        updatedAt: now,
      };
      const next = revise(current.run, {}, now);
      await this.ports.commit(current, next, "prompt_delivered", {
        prompts: [delivered],
        events: [this.ports.events.dequeuedPrompt(next, delivered)],
      });
    });
  }

  private async markFailed(
    runId: string,
    prompt: RunPromptRecord,
    error: unknown,
  ): Promise<void> {
    await this.ports.exclusive(`run:${runId}`, async () => {
      const current = await this.ports.load(runId);
      const persisted = current.prompts.find((item) => item.id === prompt.id);
      if (!persisted || persisted.status !== "queued") return;
      const now = this.ports.now();
      await this.ports.commit(
        current,
        revise(current.run, {}, now),
        "prompt_failed",
        {
          prompts: [
            {
              ...persisted,
              status: "failed",
              error: errorMessage(error).slice(0, 1_000),
              deliveryAttempts: persisted.deliveryAttempts + 1,
              updatedAt: now,
            },
          ],
        },
      );
    });
  }
}

function invalidPromptState(
  state: RunHydratedState,
  behavior: string,
): InvalidRunStateError {
  return new InvalidRunStateError(
    `Cannot ${behavior} run ${state.run.runId} while ${state.run.status}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
