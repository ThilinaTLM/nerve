import { createHash } from "node:crypto";
import {
  type NerveErrorCode,
  type OperationName,
  type PeerDescriptor,
  operationDefinition,
  operationNameSchema,
  operationParamsSchema,
  operationResultSchema,
  sandboxConversationSnapshotGetParamsSchema,
  sandboxConversationViewSnapshotSchema,
  sandboxIdSchema,
  sandboxSnapshotGetParamsSchema,
  sandboxSnapshotResultSchema,
} from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { HttpError } from "../http/errors.js";
import {
  lifecycleReadyForCommands,
  lifecycleSummary,
} from "../lifecycle/lifecycle-state.js";
import { projectConversationSnapshotFromEvents } from "./conversation-event-projection.js";
import {
  deriveSandboxContainerStatus,
  managerDerivedSandboxView,
} from "./manager-derived-sandbox-view.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

type ProtocolHandlerContext = {
  state: ManagerState;
  controller: SandboxWsServer;
  target: PeerDescriptor;
  idempotencyKey?: string;
};

export async function handleManagerProtocolMethod(
  context: ProtocolHandlerContext,
  methodInput: string,
  paramsInput: unknown,
): Promise<unknown> {
  const method = parseProtocolMethod(methodInput);
  const definition = operationDefinition(method);
  if (!definition.allowedTargetRoles.includes(context.target.role)) {
    throw protocolHttpError(
      400,
      `Method ${method} cannot target ${context.target.role}`,
      "VALIDATION_FAILED",
    );
  }
  const params = operationParamsSchema(method).parse(paramsInput ?? {});
  const idempotencyKey = context.idempotencyKey;
  if (definition.idempotency === "required" && !idempotencyKey) {
    throw protocolHttpError(
      400,
      "Idempotency key is required for this method",
      "VALIDATION_FAILED",
    );
  }
  const run = async () => {
    const result = await dispatchSandboxMethod(context, method, params);
    return operationResultSchema(method).parse(result);
  };
  if (!idempotencyKey || definition.idempotency === "none") return run();
  const hash = createHash("sha256")
    .update(JSON.stringify({ method, params, target: context.target }))
    .digest("hex");
  const stored = await context.state.idempotency.get<unknown>(idempotencyKey);
  if (stored) {
    if (stored.hash !== hash)
      throw protocolHttpError(
        409,
        "Idempotency key reused with different request",
        "IDEMPOTENCY_CONFLICT",
      );
    return stored.value;
  }
  const value = await run();
  await context.state.idempotency.put(idempotencyKey, hash, value);
  return value;
}

async function dispatchSandboxMethod(
  context: ProtocolHandlerContext,
  method: OperationName,
  params: unknown,
): Promise<unknown> {
  if (context.target.role === "sandbox_agent") {
    return forwardSandboxOperation(context, method, params);
  }
  if (context.target.role !== "sandbox_manager") {
    throw protocolHttpError(
      400,
      "Unsupported protocol target",
      "VALIDATION_FAILED",
    );
  }
  switch (method) {
    case "sandbox.snapshot.get":
      return sandboxSnapshot(context, params);
    case "sandbox.conversation.snapshot.get":
      return sandboxConversationSnapshot(context, params);
    case "sandbox.pinnedCommand.list":
      return sandboxPinnedCommandList(context, params);
    case "sandbox.pinnedCommand.create":
      return sandboxPinnedCommandCreate(context, params);
    case "sandbox.pinnedCommand.update":
      return sandboxPinnedCommandUpdate(context, params);
    case "sandbox.pinnedCommand.delete":
      return sandboxPinnedCommandDelete(context, params);
    default:
      throw protocolHttpError(404, "Method not found", "METHOD_NOT_FOUND");
  }
}

async function sandboxSnapshot(
  { state, controller }: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<unknown> {
  const { sandboxId, ...params } = sandboxSnapshotGetParamsSchema
    .extend({ sandboxId: sandboxIdParamSchema })
    .parse(paramsInput);
  const session = controller.getSession(sandboxId);
  if (session) {
    const result = await session.forwarder.send(
      session.socket,
      "sandbox.snapshot.get",
      params,
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
): Promise<unknown> {
  const { sandboxId, ...params } = sandboxConversationSnapshotGetParamsSchema
    .extend({ sandboxId: sandboxIdParamSchema })
    .parse(paramsInput);
  const session = context.controller.getSession(sandboxId);
  if (session) {
    try {
      const result = await session.forwarder.send(
        session.socket,
        "sandbox.conversation.snapshot.get",
        params,
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
): Promise<unknown> {
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

async function sandboxPinnedCommandList(
  { state }: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<unknown> {
  const { sandboxId } = sandboxIdOnlyParams(paramsInput);
  return { commands: await state.pinnedCommands.list(sandboxId) };
}

async function sandboxPinnedCommandCreate(
  { state }: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<unknown> {
  const params = paramsInput as {
    sandboxId: string;
    command: string;
    label?: string;
    cwd?: string;
  };
  return {
    command: await state.pinnedCommands.create(params.sandboxId, {
      command: params.command,
      label: params.label,
      cwd: params.cwd,
    }),
  };
}

async function sandboxPinnedCommandUpdate(
  { state }: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<unknown> {
  const params = paramsInput as {
    sandboxId: string;
    commandId: string;
    command: string;
    label?: string;
    cwd?: string;
  };
  return {
    command: await state.pinnedCommands.update(
      params.sandboxId,
      params.commandId,
      {
        command: params.command,
        label: params.label,
        cwd: params.cwd,
      },
    ),
  };
}

async function sandboxPinnedCommandDelete(
  { state }: ProtocolHandlerContext,
  paramsInput: unknown,
): Promise<unknown> {
  const params = paramsInput as { sandboxId: string; commandId: string };
  await state.pinnedCommands.delete(params.sandboxId, params.commandId);
  return { ok: true };
}

function sandboxIdOnlyParams(paramsInput: unknown): { sandboxId: string } {
  return { sandboxId: sandboxIdFromParams(paramsInput) };
}

async function forwardSandboxOperation(
  { state, controller, target, idempotencyKey }: ProtocolHandlerContext,
  method: OperationName,
  params: unknown,
): Promise<unknown> {
  const sandboxId = target.id;
  if (!sandboxId) {
    throw protocolHttpError(
      400,
      "A sandbox_agent target id is required",
      "VALIDATION_FAILED",
    );
  }
  const record = await state.sandboxes.get(sandboxId);
  if (!lifecycleReadyForCommands(record)) {
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
  return session.forwarder.send(session.socket, method, params, idempotencyKey);
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

function parseProtocolMethod(method: string): OperationName {
  const result = operationNameSchema.safeParse(method);
  if (!result.success)
    throw protocolHttpError(404, "Method not found", "METHOD_NOT_FOUND");
  return result.data;
}

function sandboxIdFromParams(params: unknown): string {
  if (isRecord(params) && typeof params.sandboxId === "string") {
    return params.sandboxId;
  }
  throw protocolHttpError(400, "sandboxId is required", "VALIDATION_FAILED");
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
