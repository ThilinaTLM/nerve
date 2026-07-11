import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createId,
  type NerveErrorCode,
  type NerveMessage,
  nerveErrorCodeSchema,
  protocolRequestMessageSchema,
} from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { readJsonBody } from "../http/body.js";
import { HttpError } from "../http/errors.js";
import { ForwardedCommandError } from "./command-forwarder.js";
import { handleManagerProtocolMethod } from "./manager-protocol-method-handlers.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

const PROTOCOL_MEDIA_TYPE = "application/vnd.nerve.protocol.v1+json";

export async function handleManagerProtocolHttpRequest(
  state: ManagerState,
  controller: SandboxWsServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const startedAt = Date.now();
  let method: string | undefined;
  let sandboxId: unknown;
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
    const request = protocolRequestMessageSchema.parse(raw);
    method = request.data.method;
    sandboxId =
      request.data.params &&
      typeof request.data.params === "object" &&
      "sandboxId" in request.data.params
        ? (request.data.params as { sandboxId?: unknown }).sandboxId
        : undefined;
    const result = await handleManagerProtocolMethod(
      {
        state,
        controller,
        target: request.target,
        idempotencyKey: request.data.idempotencyKey,
      },
      request.data.method,
      request.data.params,
    );
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
    writeProtocolJson(res, status, errorMessage(undefined, code, message));
  }
}

function errorMessage(
  replyTo: string | undefined,
  code: NerveErrorCode,
  message: string,
): NerveMessage {
  return {
    protocol: "nerve",
    version: 1,
    id: createId("msg"),
    kind: "error",
    ts: new Date().toISOString(),
    source: { role: "sandbox_manager", name: "Nerve Sandbox Manager" },
    target: { role: "ui" },
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
  if (error instanceof ForwardedCommandError) {
    return {
      status: error.status,
      code: forwardedCommandProtocolCode(error),
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

function forwardedCommandProtocolCode(
  error: ForwardedCommandError,
): NerveErrorCode {
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

function writeProtocolJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": PROTOCOL_MEDIA_TYPE });
  res.end(`${JSON.stringify(body)}\n`);
}
