import { RunCoordinator, type RunCoordinatorPorts } from "./run-coordinator.js";
import type { RunNotifyEventPort } from "./run-events.js";
import {
  type IdempotentRunEventPublisherPort,
  RunEventDeliveryService,
} from "./run-unit-of-work.js";

/** Ephemeral progress port whose buffered deliveries can be awaited. */
export interface BufferedRunNotifyEventPort extends RunNotifyEventPort {
  flush(): Promise<void>;
}

export interface RunRuntimeInput extends Omit<
  RunCoordinatorPorts,
  "flushEvents" | "notify"
> {
  publisher: IdempotentRunEventPublisherPort;
  notify: BufferedRunNotifyEventPort;
}

export interface RunRuntime {
  coordinator: RunCoordinator;
  delivery: RunEventDeliveryService;
}

export function createRunRuntime(input: RunRuntimeInput): RunRuntime {
  const { publisher, notify, ...ports } = input;
  const delivery = new RunEventDeliveryService(
    input.unitOfWork,
    publisher,
    () => input.clock.now().toISOString(),
  );
  const coordinator = new RunCoordinator({
    ...ports,
    notify,
    flushEvents: async (transition) => {
      await delivery.flushTransition(transition);
      await notify.flush();
    },
  });
  return { coordinator, delivery };
}
