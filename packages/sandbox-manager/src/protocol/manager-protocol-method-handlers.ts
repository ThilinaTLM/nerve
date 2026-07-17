import {
  type NerveErrorCode,
  type NerveMessage,
  type OperationName,
  type OperationResult,
  type ProtocolRequestData,
  operationNameSchema,
  sandboxConversationSnapshotGetParamsSchema,
  sandboxConversationViewSnapshotSchema,
  sandboxIdSchema,
  sandboxSnapshotGetParamsSchema,
  sandboxSnapshotResultSchema,
} from "@nervekit/contracts";
import type { OperationHandlerRegistry } from "@nervekit/protocol";
import type { ManagerState } from "../app/manager-state.js";
import { MANAGER_EVENT_STORE_ID } from "../events/manager-events.js";
import { HttpError } from "../http/errors.js";
import {
  lifecycleReadyForOperations,
  lifecycleSummary,
} from "../lifecycle/lifecycle-state.js";
import { projectConversationSnapshotFromEvents } from "./conversation-event-projection.js";
import {
  deriveSandboxContainerStatus,
  managerDerivedSandboxView,
} from "./manager-derived-sandbox-view.js";
import {
  createManagedSandbox,
  getManagedSandbox,
  listManagedSandboxes,
  managedContainerLogs,
  managedContainerStatus,
  managedSandboxConfig,
  managedSandboxStatus,
  removeManagedSandbox,
  restartManagedSandbox,
  startManagedSandbox,
  stopManagedSandbox,
} from "./manager-sandbox-operations.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

export type ProtocolHandlerContext = {
  state: ManagerState;
  controller: SandboxWsServer;
};

export function createManagerOperationHandlers(
  context: ProtocolHandlerContext,
): Partial<OperationHandlerRegistry> {
  const managerHandlers = {
    "sandbox.manager.recovery.get": (params) =>
      managerRecoverySnapshot(context, params),
    "sandbox.create": async (params) => ({
      sandbox: await createManagedSandbox(context.state, params),
    }),
    "sandbox.list": async () => ({
      sandboxes: await listManagedSandboxes(context.state),
    }),
    "sandbox.get": async (params) => ({
      sandbox: await getManagedSandbox(context.state, params.sandboxId),
    }),
    "sandbox.start": async (params) => ({
      sandbox: await startManagedSandbox(context.state, params.sandboxId),
    }),
    "sandbox.stop": async (params) => ({
      sandbox: await stopManagedSandbox(context.state, params.sandboxId),
    }),
    "sandbox.restart": async (params) => ({
      sandbox: await restartManagedSandbox(context.state, params.sandboxId),
    }),
    "sandbox.remove": async (params) => ({
      sandbox: await removeManagedSandbox(context.state, params),
    }),
    "sandbox.config.get": (params) =>
      managedSandboxConfig(context.state, params.sandboxId),
    "sandbox.status.get": (params) =>
      managedSandboxStatus(context.state, context.controller, params.sandboxId),
    "sandbox.container.status.get": (params) =>
      managedContainerStatus(context.state, params.sandboxId),
    "sandbox.container.logs.get": (params) =>
      managedContainerLogs(context.state, params),
    "sandbox.snapshot.get": (params) => sandboxSnapshot(context, params),
    "sandbox.conversation.snapshot.get": (params) =>
      sandboxConversationSnapshot(context, params),
    "pinnedCommand.list": async (params) => ({
      commands: await context.state.pinnedCommands.list(
        managerPinnedSandboxId(params),
      ),
    }),
    "pinnedCommand.create": async (params) => ({
      command: await context.state.pinnedCommands.create(
        managerPinnedSandboxId(params),
        { command: params.command, label: params.label, cwd: params.cwd },
      ),
    }),
    "pinnedCommand.update": async (params) => ({
      command: await context.state.pinnedCommands.update(
        managerPinnedSandboxId(params),
        params.commandId,
        { command: params.command, label: params.label, cwd: params.cwd },
      ),
    }),
    "pinnedCommand.delete": async (params) => {
      await context.state.pinnedCommands.delete(
        managerPinnedSandboxId(params),
        params.commandId,
      );
      return { ok: true as const };
    },
  } satisfies Partial<OperationHandlerRegistry>;

  return new Proxy(managerHandlers, {
    get(target, property, receiver) {
      const own = Reflect.get(target, property, receiver);
      if (own !== undefined || typeof property !== "string") return own;
      const method = operationNameSchema.parse(property);
      return (params: unknown, request: NerveMessage<ProtocolRequestData>) =>
        forwardSandboxOperation(context, method, params, request);
    },
  });
}

async function managerRecoverySnapshot(
  context: ProtocolHandlerContext,
  params: {
    sandboxId?: string;
    conversationId?: string;
    agentId?: string;
    runId?: string;
  },
): Promise<OperationResult<"sandbox.manager.recovery.get">> {
  const managerEvents = await context.state.events.list(MANAGER_EVENT_STORE_ID);
  const cursors = [
    {
      stream: "manager",
      processedSeq: lastDurableSeq(managerEvents),
    },
  ];
  const sandboxes = await listManagedSandboxes(context.state);
  if (!params.sandboxId)
    return { stateEpoch: "protocol-v1", cursors, sandboxes };
  const sandboxEvents = await context.state.events.list(params.sandboxId);
  cursors.push({
    stream: `sandbox:${params.sandboxId}`,
    processedSeq: lastDurableSeq(sandboxEvents),
  });
  const selectedSandbox = sandboxSnapshotResultSchema.parse(
    await managerDerivedSnapshot(context.state, params.sandboxId),
  );
  const projected = projectConversationSnapshotFromEvents({
    sandboxId: params.sandboxId,
    events: sandboxEvents,
    conversationId: params.conversationId,
    agentId: params.agentId,
    runId: params.runId,
  });
  const selectedConversation = sandboxConversationViewSnapshotSchema.parse({
    ...selectedSandbox,
    sandboxId: params.sandboxId,
    connected: Boolean(context.controller.getSession(params.sandboxId)),
    stale: true,
    conversationId: projected?.conversation.id ?? params.conversationId,
    agentId: projected?.conversation.activeAgentId ?? params.agentId,
    runId: params.runId,
    snapshot: projected,
    fallback: {
      conversations: selectedSandbox.conversations,
      agents: selectedSandbox.agents,
      runs: selectedSandbox.runs,
      readOnly: true,
      reason: "manager journal recovery snapshot",
    },
    generatedAt: new Date().toISOString(),
  });
  return {
    stateEpoch: "protocol-v1",
    cursors,
    sandboxes,
    selectedSandbox,
    selectedConversation,
  };
}

function lastDurableSeq(
  events: readonly { seq?: number; durability?: "durable" | "transient" }[],
): number {
  return Math.max(
    0,
    ...events
      .filter((event) => event.durability !== "transient")
      .map((event) => event.seq ?? 0),
  );
}

async function sandboxSnapshot(
  { state, controller }: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<OperationResult<"sandbox.snapshot.get">> {
  const { sandboxId, ...params } = sandboxSnapshotGetParamsSchema
    .extend({ sandboxId: sandboxIdParamSchema })
    .parse(paramsInput);
  const session = controller.getSession(sandboxId);
  if (session) {
    const result = await session.forwarder.send(
      session.socket,
      "sandbox.snapshot.get",
      { sandboxId, ...params },
    );
    const container = await connectedContainerStatus(state, sandboxId);
    const lifecycle = await connectedLifecycle(state, sandboxId);
    return sandboxSnapshotResultSchema.parse({
      connected: true,
      stale: false,
      lifecycle,
      container,
      ...(isRecord(result) ? result : {}),
      sandboxId,
    });
  }
  return sandboxSnapshotResultSchema.parse(
    await managerDerivedSnapshot(state, sandboxId),
  );
}

async function sandboxConversationSnapshot(
  context: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<OperationResult<"sandbox.conversation.snapshot.get">> {
  const { sandboxId, ...params } = sandboxConversationSnapshotGetParamsSchema
    .extend({ sandboxId: sandboxIdParamSchema })
    .parse(paramsInput);
  const session = context.controller.getSession(sandboxId);
  if (session) {
    try {
      const result = await session.forwarder.send(
        session.socket,
        "sandbox.conversation.snapshot.get",
        { sandboxId, ...params },
      );
      return sandboxConversationViewSnapshotSchema.parse({
        connected: true,
        stale: false,
        ...(isRecord(result) ? result : {}),
        sandboxId,
        generatedAt:
          isRecord(result) && typeof result.generatedAt === "string"
            ? result.generatedAt
            : new Date().toISOString(),
      });
    } catch (error) {
      // The controller session exists but is unresponsive (timeout) or failed.
      // Degrade to the durable-event projection instead of hanging/500ing the
      // UI so the transcript still renders in a read-only stale view.
      return derivedConversationView(context.state, sandboxId, params, {
        connected: true,
        reason: `controller unresponsive: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  return derivedConversationView(context.state, sandboxId, params, {
    connected: false,
    reason: "controller disconnected",
  });
}

async function derivedConversationView(
  state: ManagerState,
  sandboxId: string,
  params: {
    conversationId?: string;
    agentId?: string;
    runId?: string;
  },
  options: { connected: boolean; reason: string },
): Promise<OperationResult<"sandbox.conversation.snapshot.get">> {
  const base = await managerDerivedSnapshot(state, sandboxId);
  const events = await state.events.list(sandboxId);
  const snapshot = projectConversationSnapshotFromEvents({
    sandboxId,
    events,
    conversationId: params.conversationId,
    agentId: params.agentId,
    runId: params.runId,
  });
  return sandboxConversationViewSnapshotSchema.parse({
    ...base,
    sandboxId,
    connected: options.connected,
    stale: true,
    conversationId: snapshot?.conversation.id ?? params.conversationId,
    agentId: snapshot?.conversation.activeAgentId ?? params.agentId,
    runId: params.runId,
    snapshot,
    fallback: {
      conversations:
        isRecord(base) && Array.isArray(base.conversations)
          ? base.conversations
          : [],
      agents: isRecord(base) && Array.isArray(base.agents) ? base.agents : [],
      runs: isRecord(base) && Array.isArray(base.runs) ? base.runs : [],
      readOnly: true,
      reason: snapshot
        ? `${options.reason} (transcript reconstructed from durable events)`
        : options.reason,
    },
    generatedAt: new Date().toISOString(),
  });
}

async function forwardSandboxOperation(
  { state, controller }: ProtocolHandlerContext,
  method: OperationName,
  params: unknown,
  request: NerveMessage<ProtocolRequestData>,
): Promise<unknown> {
  const sandboxId = request.target.id;
  if (!sandboxId) {
    throw protocolHttpError(
      400,
      "A sandbox_agent target id is required",
      "VALIDATION_FAILED",
    );
  }
  const record = await state.sandboxes.get(sandboxId);
  if (!lifecycleReadyForOperations(record)) {
    throw protocolHttpError(
      409,
      "Sandbox is still booting; commands are disabled until ready",
      "BOOTING",
    );
  }
  const session = controller.getSession(sandboxId);
  if (!session)
    throw protocolHttpError(
      503,
      "Sandbox command forwarding requires a connected controller session",
      "SERVICE_UNAVAILABLE",
    );
  return session.forwarder.send(
    session.socket,
    method,
    params,
    request.data.idempotencyKey,
    request.data.timeoutMs,
    {
      correlationId: request.correlationId ?? request.id,
      causationId: request.id,
      traceId: request.traceId,
    },
  );
}

async function managerDerivedSnapshot(
  state: ManagerState,
  sandboxId: string,
): Promise<Record<string, unknown>> {
  const view = await managerDerivedSandboxView(state, sandboxId);
  if (!view)
    throw protocolHttpError(404, "Sandbox not found", "RESOURCE_NOT_FOUND");
  return view.snapshot;
}

async function connectedContainerStatus(
  state: ManagerState,
  sandboxId: string,
): Promise<unknown> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) return undefined;
  return (await deriveSandboxContainerStatus(state, record)).container;
}

async function connectedLifecycle(
  state: ManagerState,
  sandboxId: string,
): Promise<ReturnType<typeof lifecycleSummary> | undefined> {
  const record = await state.sandboxes.get(sandboxId);
  return record ? lifecycleSummary(record) : undefined;
}

function managerPinnedSandboxId(
  params: { sandboxId: string } | { projectId: string },
): string {
  if ("sandboxId" in params) return params.sandboxId;
  throw protocolHttpError(
    400,
    "Sandbox manager pinned commands require sandboxId",
    "VALIDATION_FAILED",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const sandboxIdParamSchema = sandboxIdSchema;

function protocolHttpError(
  status: number,
  message: string,
  code: NerveErrorCode,
): HttpError {
  return new HttpError(status, message, code);
}
