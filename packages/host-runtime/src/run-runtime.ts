import { RunCoordinator, type RunCoordinatorPorts } from "./run-coordinator.js";
import type { RunTransientEventPort } from "./run-events.js";
import {
  type IdempotentRunEventPublisherPort,
  RunEventDeliveryService,
} from "./run-unit-of-work.js";

/**
 * Transient progress port whose buffered deliveries can be awaited. Hosts hand
 * this to `createRunRuntime()` so durable event intents always land before the
 * transient tail is flushed.
 */
export interface BufferedRunTransientEventPort extends RunTransientEventPort {
  flush(): Promise<void>;
}

export interface RunRuntimeInput extends Omit<
  RunCoordinatorPorts,
  "flushEvents" | "transient"
> {
  /** Idempotent durable event publisher owned by the host. */
  publisher: IdempotentRunEventPublisherPort;
  /** Buffered transient progress publisher owned by the host. */
  transient: BufferedRunTransientEventPort;
}

export interface RunRuntime {
  coordinator: RunCoordinator;
  delivery: RunEventDeliveryService;
}

/**
 * Shared RunCoordinator composition invariant for every host: one
 * `RunEventDeliveryService` per coordinator, durable event intents delivered
 * before the transient tail flushes, and delivery timestamps taken from the
 * injected clock. Hosts keep their own unit of work, references, cancellation,
 * execution, integrity, diagnostics, IDs, retry policy, and observers.
 */
export function createRunRuntime(input: RunRuntimeInput): RunRuntime {
  const { publisher, transient, ...ports } = input;
  const delivery = new RunEventDeliveryService(
    input.unitOfWork,
    publisher,
    () => input.clock.now().toISOString(),
  );
  const coordinator = new RunCoordinator({
    ...ports,
    transient,
    flushEvents: async (transition) => {
      await delivery.flushTransition(transition);
      await transient.flush();
    },
  });
  return { coordinator, delivery };
}
