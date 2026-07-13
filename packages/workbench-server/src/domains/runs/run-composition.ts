import { randomUUID } from "node:crypto";
import {
  type DiagnosticPort,
  RunCoordinator,
  RunEventDeliveryService,
} from "@nervekit/host-runtime";
import type { AgentRecord } from "@nervekit/contracts";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
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
import { WorkbenchRunStatusProjector } from "./workbench-run-status-projector.js";

export interface WorkbenchRunRuntime {
  coordinator: RunCoordinator;
  unitOfWork: WorkbenchRunUnitOfWork;
  references: WorkbenchRunReferences;
  live: WorkbenchLiveExecutions;
  delivery: RunEventDeliveryService;
  statusProjector: WorkbenchRunStatusProjector;
}

export function createWorkbenchRunRuntime(input: {
  home: string;
  state: RuntimeState;
  events: EventBus;
  tools: ToolService;
  tasks: WorkbenchTaskService;
  harnessStorage: ConversationHarnessStorage;
  execution:
    | WorkbenchRunExecutionAdapter
    | ((references: WorkbenchRunReferences) => WorkbenchRunExecutionAdapter);
  logger?: ApplicationLogger;
  retryPolicy: {
    readonly enabled: boolean;
    readonly maxRetries: number;
    readonly baseDelayMs: number;
  };
  setAgentStatus(
    agent: AgentRecord,
    status: AgentRecord["status"],
  ): Promise<void>;
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
    input.harnessStorage,
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
  const statusProjector = new WorkbenchRunStatusProjector(
    input.state,
    input.setAgentStatus,
  );
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
    retryPolicy: input.retryPolicy,
    transitionObserver: statusProjector,
    flushEvents: async () => {
      await delivery.flush();
      await transient.flush();
    },
    diagnostics: diagnostics(input.logger),
  });
  cancellation.bindCancelRun((runId, reason) =>
    coordinator.cancel(runId, reason),
  );
  return {
    coordinator,
    unitOfWork,
    references,
    live,
    delivery,
    statusProjector,
  };
}

function diagnostics(logger?: ApplicationLogger): DiagnosticPort {
  return {
    debug: (message, data) => void logger?.debug(message, { context: data }),
    warn: (message, data) => void logger?.warn(message, { context: data }),
    error: (message, data) => void logger?.error(message, { context: data }),
  };
}
