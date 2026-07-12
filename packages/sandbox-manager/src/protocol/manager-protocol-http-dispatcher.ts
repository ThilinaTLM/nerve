import type { IncomingMessage, ServerResponse } from "node:http";
import {
  allOperationDefinitions,
  createId,
  type NerveErrorCode,
  type NerveMessage,
  type PeerDescriptor,
  type ProtocolRequestData,
  nerveErrorCodeSchema,
  protocolRequestMessageSchema,
} from "@nervekit/contracts";
import { MemoryIdempotencyStore, RpcDispatcher } from "@nervekit/protocol";
import type { ManagerState } from "../app/manager-state.js";
import { readJsonBody } from "../http/body.js";
import { HttpError } from "../http/errors.js";
import { ForwardedRpcError } from "./rpc-forwarder.js";
import { createManagerOperationHandlers } from "./manager-protocol-method-handlers.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

const PROTOCOL_MEDIA_TYPE = "application/vnd.nerve.protocol.v1+json";
const managerDispatchers = new WeakMap<ManagerState, RpcDispatcher>();
const managerAcceptedCapabilities = allOperationDefinitions()
  .filter(
    (definition) =>
      definition.allowedTargetRoles.includes("sandbox_manager") ||
      definition.allowedTargetRoles.includes("sandbox_agent"),
  )
  .map((definition) => definition.requiredCapability)
  .filter((capability): capability is string => Boolean(capability));

export async function handleManagerProtocolHttpRequest(
  state: ManagerState,
  controller: SandboxWsServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const startedAt = Date.now();
  let method: string | undefined;
  let sandboxId: unknown;
  let request: NerveMessage<ProtocolRequestData> | undefined;
  try {
    if (req.method !== "POST") {
      writeProtocolJson(
        res,
        405,
        errorMessage(undefined, "VALIDATION_FAILED", "Method not allowed"),
      );
      return;
    }
    const raw = await readJsonBody(req);
    request = protocolRequestMessageSchema.parse(
      raw,
    ) as NerveMessage<ProtocolRequestData>;
    method = request.data.method;
    sandboxId =
      request.data.params &&
      typeof request.data.params === "object" &&
      "sandboxId" in request.data.params
        ? (request.data.params as { sandboxId?: unknown }).sandboxId
        : undefined;
    const dispatched = await managerRpcDispatcher(state, controller).dispatch(
      request,
    );
    if (!dispatched.ok) {
      writeProtocolJson(
        res,
        protocolStatus(dispatched.error.code),
        errorMessage(
          request.id,
          dispatched.error.code,
          dispatched.error.message,
          request.source,
        ),
      );
      return;
    }
    const result = dispatched.result;
    state.logger.debug("protocol method handled", {
      method,
      sandboxId,
      durationMs: Date.now() - startedAt,
    });
    writeProtocolJson(res, 200, {
      protocol: "nerve",
      version: 1,
      id: createId("msg"),
      kind: "response",
      ts: new Date().toISOString(),
      source: { role: "sandbox_manager", name: "Nerve Sandbox Manager" },
      target: request.source,
      correlationId: request.correlationId,
      replyTo: request.id,
      data: {
        ok: true,
        method: request.data.method,
        result,
      },
    } satisfies NerveMessage);
  } catch (error) {
    const { status, code, message } = normalizeProtocolError(error);
    state.logger[status >= 500 ? "error" : "warn"]("protocol method failed", {
      method,
      sandboxId,
      status,
      code,
      durationMs: Date.now() - startedAt,
      err: error,
    });
    writeProtocolJson(
      res,
      status,
      errorMessage(request?.id, code, message, request?.source),
    );
  }
}

export function managerRpcDispatcher(
  state: ManagerState,
  controller: SandboxWsServer,
): RpcDispatcher {
  const existing = managerDispatchers.get(state);
  if (existing) return existing;
  const dispatcher = new RpcDispatcher({
    handlers: createManagerOperationHandlers({ state, controller }),
    idempotency: new MemoryIdempotencyStore(),
    acceptedCapabilities: managerAcceptedCapabilities,
    translateError: (error) => {
      const normalized = normalizeProtocolError(error);
      return {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.status >= 500,
      };
    },
  });
  managerDispatchers.set(state, dispatcher);
  return dispatcher;
}

export function managerWebSocketRpcDispatcher(
  state: ManagerState,
  controller: SandboxWsServer,
  acceptedCapabilities: readonly string[],
): RpcDispatcher {
  return new RpcDispatcher({
    handlers: createManagerOperationHandlers({ state, controller }),
    idempotency: new MemoryIdempotencyStore(),
    acceptedCapabilities,
    translateError: (error) => {
      const normalized = normalizeProtocolError(error);
      return {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.status >= 500,
      };
    },
  });
}

function errorMessage(
  replyTo: string | undefined,
  code: NerveErrorCode,
  message: string,
  target: PeerDescriptor = { role: "ui" },
): NerveMessage {
  return {
    protocol: "nerve",
    version: 1,
    id: createId("msg"),
    kind: "error",
    ts: new Date().toISOString(),
    source: { role: "sandbox_manager", name: "Nerve Sandbox Manager" },
    target,
    replyTo,
    data: {
      code,
      message,
      retryable: code === "SERVICE_UNAVAILABLE" || code === "OPERATION_TIMEOUT",
      recovery:
        code === "SERVICE_UNAVAILABLE"
          ? { action: "load_snapshot" as const }
          : { action: "none" as const },
    },
  };
}

function normalizeProtocolError(error: unknown): {
  status: number;
  code: NerveErrorCode;
  message: string;
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: httpCodeToProtocolCode(error.code),
      message: error.message,
    };
  }
  if (error instanceof ForwardedRpcError) {
    return {
      status: error.status,
      code: forwardedRpcProtocolCode(error),
      message: error.message,
    };
  }
  if (error && typeof error === "object" && "issues" in error) {
    return {
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Protocol request validation failed",
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal protocol error",
  };
}

function forwardedRpcProtocolCode(error: ForwardedRpcError): NerveErrorCode {
  if (error.code === "OPERATION_TIMEOUT") return "OPERATION_TIMEOUT";
  if (error.status === 503) return "SERVICE_UNAVAILABLE";
  if (error.status === 404) return "RESOURCE_NOT_FOUND";
  if (error.status === 400) return "VALIDATION_FAILED";
  if (error.status === 409) return "DOMAIN_VALIDATION_FAILED";
  return httpCodeToProtocolCode(error.code);
}

function httpCodeToProtocolCode(code: string): NerveErrorCode {
  const protocolCode = nerveErrorCodeSchema.safeParse(code);
  if (protocolCode.success) return protocolCode.data;
  switch (code) {
    case "UNAUTHORIZED":
      return "AUTH_INVALID";
    case "FORBIDDEN":
      return "AUTH_FORBIDDEN";
    case "NOT_FOUND":
      return "RESOURCE_NOT_FOUND";
    case "UNAVAILABLE":
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_ERROR";
  }
}

function protocolStatus(code: NerveErrorCode): number {
  switch (code) {
    case "AUTH_REQUIRED":
    case "AUTH_INVALID":
      return 401;
    case "AUTH_FORBIDDEN":
    case "POLICY_DENIED":
    case "CAPABILITY_REQUIRED":
      return 403;
    case "METHOD_NOT_FOUND":
    case "RESOURCE_NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "DOMAIN_VALIDATION_FAILED":
      return 422;
    case "OPERATION_TIMEOUT":
      return 504;
    case "SERVICE_UNAVAILABLE":
    case "BOOTING":
      return 503;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}

function writeProtocolJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": PROTOCOL_MEDIA_TYPE });
  res.end(`${JSON.stringify(body)}\n`);
}
