import { randomUUID } from "node:crypto";
import {
  type DiagnosticPort,
  RunCoordinator,
  RunEventDeliveryService,
} from "@nervekit/host-runtime";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { HarnessManager } from "../conversations/harness-manager.js";
import type { ToolService } from "../tools/tool-service.js";
import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";
import { WorkbenchRunCancellation } from "./run-cancellation.js";
import {
  WorkbenchRunEventPublisher,
  WorkbenchRunTransientPublisher,
} from "./run-event-publisher.js";
import {
  WorkbenchRunExecutionFactory,
  type WorkbenchRunExecutionAdapter,
} from "./run-execution.js";
import { WorkbenchRunIntegrity } from "./run-integrity.js";
import { WorkbenchLiveExecutions } from "./run-live-executions.js";
import { WorkbenchRunReferences } from "./run-references.js";
import { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

export interface WorkbenchRunRuntime {
  coordinator: RunCoordinator;
  unitOfWork: WorkbenchRunUnitOfWork;
  references: WorkbenchRunReferences;
  live: WorkbenchLiveExecutions;
  delivery: RunEventDeliveryService;
}

export function createWorkbenchRunRuntime(input: {
  home: string;
  state: RuntimeState;
  events: EventBus;
  tools: ToolService;
  tasks: WorkbenchTaskService;
  harnessManager: HarnessManager;
  execution:
    | WorkbenchRunExecutionAdapter
    | ((references: WorkbenchRunReferences) => WorkbenchRunExecutionAdapter);
  logger?: ApplicationLogger;
}): WorkbenchRunRuntime {
  const unitOfWork = new WorkbenchRunUnitOfWork(input.home);
  const integrity = new WorkbenchRunIntegrity();
  const publisher = new WorkbenchRunEventPublisher(input.events);
  const transient = new WorkbenchRunTransientPublisher(input.events);
  const delivery = new RunEventDeliveryService(unitOfWork, publisher, () =>
    new Date().toISOString(),
  );
  const references = new WorkbenchRunReferences(
    unitOfWork,
    input.harnessManager,
    input.state,
  );
  const live = new WorkbenchLiveExecutions();
  const cancellation = new WorkbenchRunCancellation(
    live,
    input.tools,
    input.tasks,
    input.state,
    unitOfWork,
  );
  const adapter =
    typeof input.execution === "function"
      ? input.execution(references)
      : input.execution;
  const execution = new WorkbenchRunExecutionFactory(adapter, live);
  const coordinator = new RunCoordinator({
    sourceRole: "workbench_server",
    unitOfWork,
    execution,
    references,
    cancellation,
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    integrity,
    transient,
    flushEvents: async () => {
      await delivery.flush();
      await transient.flush();
    },
    diagnostics: diagnostics(input.logger),
  });
  cancellation.bindCancelRun((runId, reason) =>
    coordinator.cancel(runId, reason),
  );
  return { coordinator, unitOfWork, references, live, delivery };
}

function diagnostics(logger?: ApplicationLogger): DiagnosticPort {
  return {
    debug: (message, data) => void logger?.debug(message, data),
    warn: (message, data) => void logger?.warn(message, data),
    error: (message, data) => void logger?.error(message, data),
  };
}
