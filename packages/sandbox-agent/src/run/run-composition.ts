import { randomUUID } from "node:crypto";
import {
  type DiagnosticPort,
  RunCoordinator,
  RunEventDeliveryService,
} from "@nervekit/host-runtime";
import type { StructuredLogger, SandboxConfigV1 } from "@nervekit/contracts";
import { SandboxRunUnitOfWork } from "../agent/run-transition-store.js";
import type { HarnessFactory } from "../agent/harness-factory.js";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import type { EventOutbox } from "../state/event-outbox.js";
import type { SandboxTaskService } from "../tools/sandbox-task-service.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import { SandboxInteractionChannel } from "./interaction-channel.js";
import { SandboxLiveHarnessRegistry } from "./live-registry.js";
import { SandboxPendingInteractions } from "./pending-interactions.js";
import { SandboxRunCancellation } from "./run-cancellation.js";
import {
  SandboxRunEventPublisher,
  SandboxRunTransientPublisher,
} from "./run-event-publisher.js";
import { SandboxRunExecutionFactory } from "./run-execution.js";
import { SandboxRunIntegrity } from "./run-integrity.js";
import { SandboxRunReferences } from "./run-references.js";

export interface SandboxRunRuntimeDeps {
  config: SandboxConfigV1;
  stateDir: string;
  outbox: EventOutbox;
  harnessFactory: HarnessFactory;
  toolRuntime?: SandboxToolRuntime;
  taskService?: SandboxTaskService;
  exploreRuntime?: ExploreRuntime;
  configStore?: AgentConfigStore;
  logger?: StructuredLogger;
}

export interface SandboxRunRuntime {
  coordinator: RunCoordinator;
  unitOfWork: SandboxRunUnitOfWork;
  references: SandboxRunReferences;
  channel: SandboxInteractionChannel;
  pending: SandboxPendingInteractions;
  live: SandboxLiveHarnessRegistry;
  delivery: RunEventDeliveryService;
}

/**
 * Builds the single sandbox RunCoordinator and its host adapters. This is the
 * sole authority for run lifecycle; nothing else may mutate run state.
 */
export function createSandboxRunRuntime(
  deps: SandboxRunRuntimeDeps,
): SandboxRunRuntime {
  const unitOfWork = new SandboxRunUnitOfWork(deps.stateDir);
  const integrity = new SandboxRunIntegrity();
  const publisher = new SandboxRunEventPublisher(deps.outbox);
  const transient = new SandboxRunTransientPublisher(deps.outbox);
  const delivery = new RunEventDeliveryService(unitOfWork, publisher, () =>
    new Date().toISOString(),
  );
  const references = new SandboxRunReferences(unitOfWork, deps.harnessFactory);
  const live = new SandboxLiveHarnessRegistry();
  const channel = new SandboxInteractionChannel();
  const pending = new SandboxPendingInteractions();
  const cancellation = new SandboxRunCancellation({
    live,
    channel,
    toolRuntime: deps.toolRuntime,
    taskService: deps.taskService,
    exploreRuntime: deps.exploreRuntime,
  });
  const execution = new SandboxRunExecutionFactory({
    config: deps.config,
    harnessFactory: deps.harnessFactory,
    references,
    live,
    channel,
    pending,
    toolRuntime: deps.toolRuntime,
    configStore: deps.configStore,
    logger: deps.logger,
  });
  const coordinator = new RunCoordinator({
    sourceRole: "sandbox_agent",
    unitOfWork,
    execution,
    references,
    cancellation,
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    integrity,
    flushEvents: () => delivery.flush(),
    transient,
    diagnostics: toDiagnostics(deps.logger),
  });
  return {
    coordinator,
    unitOfWork,
    references,
    channel,
    pending,
    live,
    delivery,
  };
}

function toDiagnostics(logger?: StructuredLogger): DiagnosticPort {
  return {
    debug: (message, data) => logger?.debug(message, data),
    warn: (message, data) => logger?.warn(message, data),
    error: (message, data) => logger?.error(message, data),
  };
}
