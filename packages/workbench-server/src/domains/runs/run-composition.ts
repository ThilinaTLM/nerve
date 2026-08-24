import { randomUUID } from "node:crypto";
import {
  createRunRuntime,
  type RunCoordinator,
  type RunEventDeliveryService,
} from "./runtime/index.js";
import type { DiagnosticPort } from "../../core/ports.js";
import type { AgentRecord } from "@nervekit/contracts";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
import type { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";
import type { WorkbenchExploreAdmission } from "../agents/run/workbench-explore-admission.js";
import type { WorkbenchSubagentExecutions } from "../agents/run/workbench-subagent-executions.js";
import type { ToolService } from "../tools/tool-service.js";
import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";
import { WorkbenchRunCancellation } from "./run-cancellation.js";
import {
  WorkbenchRunEventPublisher,
  WorkbenchRunNotifyPublisher,
} from "./run-event-publisher.js";
import {
  WorkbenchRunExecutionFactory,
  type WorkbenchRunExecutionAdapter,
} from "./run-execution.js";
import { WorkbenchRunIntegrity } from "./run-integrity.js";
import { WorkbenchLiveExecutions } from "./run-live-executions.js";
import { WorkbenchRunReferences } from "./run-references.js";
import { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";
import { WorkbenchRunProjector } from "./workbench-run-projector.js";
import { WorkbenchRunTerminalization } from "./run-terminalization.js";

export interface WorkbenchRunRuntime {
  coordinator: RunCoordinator;
  unitOfWork: WorkbenchRunUnitOfWork;
  references: WorkbenchRunReferences;
  live: WorkbenchLiveExecutions;
  delivery: RunEventDeliveryService;
  projector: WorkbenchRunProjector;
}

export function createWorkbenchRunRuntime(input: {
  home: string;
  journal: ConversationJournalRepository;
  state: RuntimeState;
  events: StreamLogRegistry;
  tools: ToolService;
  tasks: WorkbenchTaskService;
  harnessStorage: ConversationHarnessStorage;
  subagentExecutions: WorkbenchSubagentExecutions;
  exploreAdmission: WorkbenchExploreAdmission;
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
  const unitOfWork = new WorkbenchRunUnitOfWork(input.journal);
  const integrity = new WorkbenchRunIntegrity();
  const publisher = new WorkbenchRunEventPublisher(input.events);
  const notify = new WorkbenchRunNotifyPublisher(input.events);
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
    input.subagentExecutions,
    unitOfWork,
  );
  const terminalization = new WorkbenchRunTerminalization(input.tools);
  const adapter =
    typeof input.execution === "function"
      ? input.execution(references)
      : input.execution;
  const execution = new WorkbenchRunExecutionFactory(
    adapter,
    live,
    input.exploreAdmission,
  );
  const projector = new WorkbenchRunProjector(
    input.state,
    input.setAgentStatus,
  );
  const { coordinator, delivery } = createRunRuntime({
    sourceRole: "workbench_server",
    unitOfWork,
    execution,
    references,
    cancellation,
    terminalization,
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    integrity,
    publisher,
    notify,
    retryPolicy: input.retryPolicy,
    transitionObserver: projector,
    diagnostics: diagnostics(input.logger),
  });
  return {
    coordinator,
    unitOfWork,
    references,
    live,
    delivery,
    projector,
  };
}

function diagnostics(logger?: ApplicationLogger): DiagnosticPort {
  return {
    debug: (message, data) => void logger?.debug(message, { context: data }),
    warn: (message, data) => void logger?.warn(message, { context: data }),
    error: (message, data) => void logger?.error(message, { context: data }),
  };
}
