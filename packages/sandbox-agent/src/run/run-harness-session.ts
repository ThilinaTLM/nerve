import type { StructuredLogger } from "@nervekit/contracts";
import type {
  AgentHarness,
  AgentHarnessEvent,
} from "@nervekit/host-runtime/harness";
import type { PromptImage } from "@nervekit/contracts";
import type { HarnessFactory } from "../agent/harness-factory.js";
import type { SandboxLiveHarnessRegistry } from "./live-registry.js";
import type { SandboxHarnessPromptPort } from "./run-prompt-control.js";

/** Identity of one run execution attempt used across sandbox collaborators. */
export interface SandboxRunScope {
  readonly conversationId: string;
  readonly agentId: string;
  readonly runId: string;
  readonly executionId: string;
}

/**
 * Owns the live harness lifecycle for one run execution attempt: harness
 * creation, the local abort controller with external-abort linkage,
 * live-registry registration/removal, subscription disposal, the serialized
 * projection tail, and prompt/continue invocation.
 */
export class SandboxHarnessSession implements SandboxHarnessPromptPort {
  private harness?: AgentHarness;
  private readonly abortController = new AbortController();
  private projectionTail: Promise<void> = Promise.resolve();
  private disposeSubscription?: () => void;

  constructor(
    private readonly deps: {
      scope: SandboxRunScope;
      harnessFactory: HarnessFactory;
      live: SandboxLiveHarnessRegistry;
      log: StructuredLogger;
    },
  ) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get aborted(): boolean {
    return this.abortController.signal.aborted;
  }

  attachExternalAbort(signal: AbortSignal): void {
    signal.addEventListener("abort", () => this.abortController.abort(), {
      once: true,
    });
  }

  /** Aborts the local signal and any live harness call. */
  async cancel(reason = "cancelled"): Promise<void> {
    this.abortController.abort(reason);
    await this.harness?.abort().catch(() => undefined);
  }

  /**
   * Creates the harness, registers it in the live registry, and connects the
   * serialized event projection. `queue_drained` events return the projection
   * promise so harness queue restoration remains transactional on failure.
   */
  async open(
    project: (event: AgentHarnessEvent) => Promise<void>,
  ): Promise<void> {
    const harness = await this.deps.harnessFactory.create(this.deps.scope);
    this.harness = harness;
    this.deps.live.set(this.deps.scope.runId, {
      harness,
      abort: this.abortController,
    });
    this.disposeSubscription = harness.subscribe((event) => {
      const projected = this.projectionTail.then(() => project(event));
      this.projectionTail = projected.catch((error) =>
        this.deps.log.warn("run projection failed", { err: error }),
      );
      // Delivery is transactional with harness dequeue. Let failures reject
      // this event so AgentHarness restores the taken queue entries.
      if (event.type === "queue_drained") return projected;
    });
  }

  prompt(
    text: string,
    options?: { images?: PromptImage[] },
  ): ReturnType<AgentHarness["prompt"]> {
    return this.required().prompt(text, options);
  }

  continue(): ReturnType<AgentHarness["continue"]> {
    return this.required().continue();
  }

  steer(
    text: string,
    options: { id: string; images?: PromptImage[] },
  ): Promise<unknown> {
    return Promise.resolve(this.required().steer(text, options));
  }

  followUp(
    text: string,
    options: { id: string; images?: PromptImage[] },
  ): Promise<unknown> {
    return Promise.resolve(this.required().followUp(text, options));
  }

  async removeQueuedMessage(promptId: string): Promise<boolean> {
    return (await this.harness?.removeQueuedMessage(promptId)) ?? false;
  }

  /** Awaits the complete projection tail before interpreting results. */
  waitForProjection(): Promise<void> {
    return this.projectionTail;
  }

  /** Removes the subscription and live registration. Safe to call always. */
  dispose(): void {
    this.disposeSubscription?.();
    this.disposeSubscription = undefined;
    this.deps.live.delete(this.deps.scope.runId);
  }

  private required(): AgentHarness {
    if (!this.harness) {
      throw new Error("UNAVAILABLE: harness session is not open");
    }
    return this.harness;
  }
}
