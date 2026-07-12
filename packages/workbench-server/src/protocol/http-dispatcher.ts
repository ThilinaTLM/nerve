import { join } from "node:path";
import { GitWorkflowError } from "@nervekit/host-runtime/tools";
import {
  type NerveErrorCode,
  type NerveMessage,
  operationDefinition,
  operationNameSchema,
  type ProtocolErrorData,
  type ProtocolRequestData,
  protocolRequestMessageSchema,
} from "@nervekit/contracts";
import {
  type OperationHandlerRegistry,
  RpcDispatcher,
} from "@nervekit/protocol";
import { ZodError } from "zod";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { HttpError } from "../http/errors.js";
import { FileIdempotencyStore } from "./file-idempotency-store.js";
import { createProtocolMessage, orchestratorSource } from "./messages.js";
import {
  handleProtocolMethod,
  WORKBENCH_OPERATION_METHODS,
} from "./method-handlers.js";
import { protocolErrorData, redactProtocolValue } from "./protocol-errors.js";

export const PROTOCOL_HTTP_CONTENT_TYPE =
  "application/vnd.nerve.protocol.v1+json";
const MAX_PROTOCOL_HTTP_BODY_BYTES = 4 * 1024 * 1024;
const workbenchDispatchers = new WeakMap<OrchestratorState, RpcDispatcher>();
const workbenchMethods = new Set<string>(WORKBENCH_OPERATION_METHODS);
const workbenchCapabilities = WORKBENCH_OPERATION_METHODS.map(
  (method) => operationDefinition(method).requiredCapability,
).filter((capability): capability is string => Boolean(capability));

export class ProtocolHttpDispatcher {
  readonly #dispatcher: RpcDispatcher;

  constructor(private readonly state: OrchestratorState) {
    this.#dispatcher = workbenchRpcDispatcher(state);
  }

  async dispatch(request: Request): Promise<Response> {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PROTOCOL_HTTP_BODY_BYTES) {
      return this.error(
        undefined,
        "MESSAGE_TOO_LARGE",
        "Request body is too large",
        413,
        true,
      );
    }
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PROTOCOL_HTTP_BODY_BYTES) {
      return this.error(
        undefined,
        "MESSAGE_TOO_LARGE",
        "Request body is too large",
        413,
        true,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.error(
        undefined,
        "INVALID_JSON",
        "Request body is not valid JSON",
        400,
      );
    }

    const parsed = protocolRequestMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return this.error(
        messageId(raw),
        "INVALID_MESSAGE",
        "Protocol request envelope is invalid",
        400,
        false,
        parsed.error.flatten(),
      );
    }
    const message = parsed.data as NerveMessage<ProtocolRequestData>;
    const dispatched = await this.#dispatcher.dispatch(message);
    if (!dispatched.ok) {
      return this.error(
        message.id,
        dispatched.error.code,
        dispatched.error.message,
        protocolStatus(dispatched.error.code),
        dispatched.error.close,
        dispatched.error.details,
      );
    }

    const result = dispatched.result;
    return protocolJson(
      createProtocolMessage(
        "response",
        {
          ok: true,
          method: message.data.method,
          result,
          cursor:
            result && typeof result === "object" && "cursor" in result
              ? (result as { cursor?: unknown }).cursor
              : undefined,
        },
        {
          source: orchestratorSource(this.state.daemonId),
          replyTo: message.id,
          correlationId: message.id,
        },
      ),
    );
  }

  private error(
    replyTo: string | undefined,
    code: NerveErrorCode,
    message: string,
    status: number,
    close = false,
    details?: unknown,
  ): Response {
    const envelope = createProtocolMessage(
      "error",
      protocolErrorData(code, message, {
        close,
        retryable: status === 429 || status >= 500,
        details: details
          ? (redactProtocolValue(details) as Record<string, unknown>)
          : undefined,
        recovery:
          status === 429
            ? { action: "retry", retryAfterMs: 10_000 }
            : undefined,
      }),
      {
        source: orchestratorSource(this.state.daemonId),
        replyTo,
        correlationId: replyTo,
      },
    );
    return protocolJson(envelope, status);
  }
}

export function workbenchOperationHandlers(
  state: OrchestratorState,
): Partial<OperationHandlerRegistry> {
  return new Proxy<Partial<OperationHandlerRegistry>>(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || !workbenchMethods.has(property))
          return undefined;
        const method = operationNameSchema.parse(property);
        return (params: unknown) => handleProtocolMethod(state, method, params);
      },
    },
  );
}

export function workbenchRpcDispatcher(
  state: OrchestratorState,
): RpcDispatcher {
  const existing = workbenchDispatchers.get(state);
  if (existing) return existing;
  const dispatcher = new RpcDispatcher({
    handlers: workbenchOperationHandlers(state),
    idempotency: new FileIdempotencyStore(
      join(state.storage.paths.home, "protocol", "idempotency-v1.json"),
    ),
    acceptedCapabilities: workbenchCapabilities,
    translateError,
  });
  workbenchDispatchers.set(state, dispatcher);
  return dispatcher;
}

export function workbenchWebSocketRpcDispatcher(
  state: OrchestratorState,
  acceptedCapabilities: readonly string[],
): RpcDispatcher {
  return new RpcDispatcher({
    handlers: workbenchOperationHandlers(state),
    idempotency: new FileIdempotencyStore(
      join(state.storage.paths.home, "protocol", "idempotency-v1.json"),
    ),
    acceptedCapabilities,
    translateError,
  });
}

function translateError(error: unknown): ProtocolErrorData {
  if (error instanceof HttpError) {
    return {
      code: mapHttpCode(error.code),
      message: error.message,
      retryable: error.status === 429 || error.status >= 500,
    };
  }
  if (error instanceof GitWorkflowError) {
    return {
      code: mapHttpCode(error.code),
      message: error.message,
      retryable: error.status === 429 || error.status >= 500,
    };
  }
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION_FAILED",
      message: "Protocol response validation failed",
      retryable: false,
      details: redactProtocolValue(error.flatten()) as Record<string, unknown>,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Operation failed",
    retryable: true,
  };
}

function protocolJson(message: NerveMessage, status = 200): Response {
  return Response.json(message, {
    status,
    headers: { "Content-Type": PROTOCOL_HTTP_CONTENT_TYPE },
  });
}

function messageId(raw: unknown): string | undefined {
  return raw && typeof raw === "object" && "id" in raw
    ? String((raw as { id: unknown }).id)
    : undefined;
}

function mapHttpCode(code: string): NerveErrorCode {
  if (code.endsWith("_NOT_FOUND")) return "RESOURCE_NOT_FOUND";
  if (code.includes("POLICY")) return "POLICY_DENIED";
  if (code.includes("CONFLICT")) return "CONFLICT";
  return "INTERNAL_ERROR";
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
