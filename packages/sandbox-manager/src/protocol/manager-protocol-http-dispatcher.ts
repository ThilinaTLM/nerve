import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createId,
  type NerveErrorCode,
  type NerveMessage,
  protocolRequestMessageSchema,
} from "@nervekit/shared";
import type { ManagerState } from "../app/manager-state.js";
import { readJsonBody } from "../http/body.js";
import { HttpError } from "../http/errors.js";
import { handleManagerProtocolMethod } from "./manager-protocol-method-handlers.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

const PROTOCOL_MEDIA_TYPE = "application/vnd.nerve.protocol.v1+json";

export async function handleManagerProtocolHttpRequest(
  state: ManagerState,
  controller: SandboxWsServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
    const result = await handleManagerProtocolMethod(
      {
        state,
        controller,
        idempotencyKey: request.data.idempotencyKey,
      },
      request.data.method,
      request.data.params,
    );
    writeProtocolJson(res, 200, {
      protocol: "nerve",
      version: 1,
      id: createId("msg"),
      kind: "response",
      ts: new Date().toISOString(),
      source: { role: "orchestrator", name: "Nerve Sandbox Manager" },
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
    source: { role: "orchestrator", name: "Nerve Sandbox Manager" },
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

function httpCodeToProtocolCode(code: string): NerveErrorCode {
  switch (code) {
    case "UNAUTHORIZED":
      return "AUTH_INVALID";
    case "FORBIDDEN":
      return "AUTH_FORBIDDEN";
    case "NOT_FOUND":
      return "RESOURCE_NOT_FOUND";
    case "UNAVAILABLE":
      return "SERVICE_UNAVAILABLE";
    case "IDEMPOTENCY_CONFLICT":
      return "IDEMPOTENCY_CONFLICT";
    case "VALIDATION_FAILED":
      return "VALIDATION_FAILED";
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
