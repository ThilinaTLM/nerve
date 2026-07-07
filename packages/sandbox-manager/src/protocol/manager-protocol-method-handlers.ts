import { createHash } from "node:crypto";
import {
  type NerveErrorCode,
  type ProtocolMethodName,
  protocolMethodDefinition,
  protocolMethodNameSchema,
  protocolMethodParamsSchema,
  protocolMethodResultSchema,
  sandboxAgentConfigureParamsSchema,
  sandboxConversationSnapshotGetParamsSchema,
  sandboxConversationViewSnapshotSchema,
  sandboxIdSchema,
  sandboxRunCancelParamsSchema,
  sandboxRunContinueParamsSchema,
  sandboxRunStartParamsSchema,
  sandboxSnapshotGetParamsSchema,
  sandboxSnapshotResultSchema,
  sandboxToolCallGetParamsSchema,
} from "@nervekit/shared";
import type { ManagerState } from "../app/manager-state.js";
import { HttpError } from "../http/errors.js";
import {
  projectConversationSnapshotFromEvents,
  projectSandboxSummariesFromEvents,
} from "./conversation-event-projection.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

type ProtocolHandlerContext = {
  state: ManagerState;
  controller: SandboxWsServer;
  idempotencyKey?: string;
};

const FORWARDED_METHODS: Partial<Record<ProtocolMethodName, string>> = {
  "sandbox.agent.prompt": "sandbox.run.start",
  "sandbox.agent.abort": "sandbox.run.cancel",
  "sandbox.agent.continue": "sandbox.run.continue",
  "sandbox.agent.configure": "sandbox.agent.configure",
  "sandbox.toolCall.get": "sandbox.toolCall.get",
};

export async function handleManagerProtocolMethod(
  context: ProtocolHandlerContext,
  methodInput: string,
  paramsInput: unknown,
): Promise<unknown> {
  const method = parseProtocolMethod(methodInput);
  if (!method.startsWith("sandbox."))
    throw protocolHttpError(404, "Method not found", "METHOD_NOT_FOUND");
  const definition = protocolMethodDefinition(method);
  const params = protocolMethodParamsSchema(method).parse(paramsInput ?? {});
  const idempotencyKey =
    context.idempotencyKey ??
    (isRecord(params) && typeof params.commandId === "string"
      ? params.commandId
      : undefined);
  if (definition.idempotency === "required" && !idempotencyKey) {
    throw protocolHttpError(
      400,
      "Idempotency key is required for this method",
      "VALIDATION_FAILED",
    );
  }
  const run = async () => {
    const result = await dispatchSandboxMethod(context, method, params);
    return protocolMethodResultSchema(method).parse(result);
  };
  if (!idempotencyKey || definition.idempotency === "none") return run();
  const hash = createHash("sha256")
    .update(JSON.stringify({ method, params }))
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
  method: ProtocolMethodName,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "sandbox.snapshot.get":
      return sandboxSnapshot(context, params);
    case "sandbox.conversation.snapshot.get":
      return sandboxConversationSnapshot(context, params);
    case "sandbox.agent.prompt":
    case "sandbox.agent.abort":
    case "sandbox.agent.continue":
    case "sandbox.agent.configure":
    case "sandbox.toolCall.get":
      return forwardSandboxCommand(context, method, params);
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
    return sandboxSnapshotResultSchema.parse({
      connected: true,
      stale: false,
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

async function forwardSandboxCommand(
  { controller }: ProtocolHandlerContext,
  method: ProtocolMethodName,
  paramsInput: unknown,
): Promise<unknown> {
  const sandboxId = sandboxIdFromParams(paramsInput);
  const session = controller.getSession(sandboxId);
  if (!session)
    throw protocolHttpError(
      503,
      "Sandbox command forwarding requires a connected controller session",
      "SERVICE_UNAVAILABLE",
    );
  const internalMethod = FORWARDED_METHODS[method];
  if (!internalMethod)
    throw protocolHttpError(404, "Method not found", "METHOD_NOT_FOUND");
  const params = stripSandboxId(normalizeForwardedParams(method, paramsInput));
  return session.forwarder.send(
    session.socket,
    internalMethod,
    params,
    requestIdFromParams(params) ?? `req_${Date.now()}`,
  );
}

function normalizeForwardedParams(
  method: ProtocolMethodName,
  params: unknown,
): Record<string, unknown> {
  switch (method) {
    case "sandbox.agent.prompt":
      return sandboxRunStartParamsSchema
        .extend({ sandboxId: sandboxIdParamSchema })
        .parse(params);
    case "sandbox.agent.abort":
      return sandboxRunCancelParamsSchema
        .extend({ sandboxId: sandboxIdParamSchema })
        .parse(params);
    case "sandbox.agent.continue":
      return sandboxRunContinueParamsSchema
        .extend({ sandboxId: sandboxIdParamSchema })
        .parse(params);
    case "sandbox.agent.configure":
      return sandboxAgentConfigureParamsSchema
        .extend({ sandboxId: sandboxIdParamSchema })
        .parse(params);
    case "sandbox.toolCall.get":
      return sandboxToolCallGetParamsSchema
        .extend({ sandboxId: sandboxIdParamSchema })
        .parse(params);
    default:
      return {};
  }
}

async function managerDerivedSnapshot(
  state: ManagerState,
  sandboxId: string,
): Promise<Record<string, unknown>> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record)
    throw protocolHttpError(404, "Sandbox not found", "RESOURCE_NOT_FOUND");
  const session = await state.sessions.get(sandboxId);
  const events = await state.events.list(sandboxId);
  const lastEvent = events
    .filter((event) => typeof event.seq === "number" || event.ts)
    .sort((a, b) => Number(a.seq ?? -1) - Number(b.seq ?? -1))
    .at(-1);
  const now = new Date().toISOString();
  const disconnectedAt = session?.disconnectedAt ?? record.stoppedAt;
  const summaries = projectSandboxSummariesFromEvents({ sandboxId, events });
  return {
    sandboxId: record.sandboxId,
    instanceId: record.instanceId ?? "unknown",
    status:
      record.observedState === "failed"
        ? "failed"
        : record.observedState === "stopping"
          ? "stopping"
          : record.observedState === "starting" ||
              record.observedState === "creating"
            ? "booting"
            : "reconnecting",
    connected: false,
    stale: true,
    staleness: {
      stale: true,
      reason: session ? "controller_disconnected" : "no_controller_session",
      asOf: now,
      lastConnectedAt: session?.updatedAt,
      disconnectedAt,
      ageMs: disconnectedAt
        ? Math.max(0, Date.now() - Date.parse(disconnectedAt))
        : undefined,
    },
    lastEventSeq: lastEvent?.seq,
    lastEventAt: lastEvent?.ts,
    lastSession: session
      ? {
          sessionId: session.sessionId,
          status:
            session.state === "exited"
              ? "closed"
              : session.state === "reconnecting"
                ? "disconnected"
                : session.state,
          connectedAt: session.updatedAt,
          disconnectedAt: session.disconnectedAt,
          closeCode: session.closeCode,
          closeReason: session.closeReason?.trim() || undefined,
          acceptedCapabilities: session.capabilities,
        }
      : undefined,
    limitations: [
      "Snapshot is manager-derived because no controller session is connected",
    ],
    conversations: summaries.conversations,
    agents: summaries.agents,
    runs: summaries.runs,
    replayCursors: [
      {
        stream: `sandbox:${sandboxId}`,
        processedSeq: Number(lastEvent?.seq ?? 0),
      },
    ],
  };
}

function parseProtocolMethod(method: string): ProtocolMethodName {
  const result = protocolMethodNameSchema.safeParse(method);
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

function stripSandboxId(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const { sandboxId: _sandboxId, ...rest } = params;
  return rest;
}

function requestIdFromParams(
  params: Record<string, unknown>,
): string | undefined {
  return typeof params.commandId === "string" && params.commandId.trim()
    ? params.commandId
    : undefined;
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
