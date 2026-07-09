import {
  type NerveErrorCode,
  type NerveMessage,
  type ProtocolRequestData,
  protocolMethodDefinition,
  protocolMethodNameSchema,
  protocolRequestMessageSchema,
} from "@nervekit/shared";
import { GitWorkflowError } from "@nervekit/tools";
import { ZodError } from "zod";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { HttpError } from "../http/errors.js";
import { IdempotencyStore } from "./idempotency-store.js";
import { createProtocolMessage, orchestratorSource } from "./messages.js";
import { handleProtocolMethod } from "./method-handlers.js";
import { protocolErrorData, redactProtocolValue } from "./protocol-errors.js";

export const PROTOCOL_HTTP_CONTENT_TYPE =
  "application/vnd.nerve.protocol.v1+json";
const MAX_PROTOCOL_HTTP_BODY_BYTES = 4 * 1024 * 1024;

export class ProtocolHttpDispatcher {
  readonly idempotency = new IdempotencyStore();

  constructor(private readonly state: OrchestratorState) {}

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
    const methodName = protocolMethodNameSchema.safeParse(message.data.method);
    if (!methodName.success) {
      return this.error(
        message.id,
        "METHOD_NOT_FOUND",
        "Protocol method was not found",
        404,
      );
    }
    const definition = protocolMethodDefinition(methodName.data);
    const paramsResult = definition.paramsSchema.safeParse(message.data.params);
    if (!paramsResult.success) {
      return this.error(
        message.id,
        "VALIDATION_FAILED",
        "Protocol method params are invalid",
        422,
        false,
        paramsResult.error.flatten(),
      );
    }

    const scope = message.source?.id ?? "anonymous";
    const key = message.data.idempotencyKey;
    if (key && definition.idempotency !== "none") {
      const cached = this.idempotency.lookup(
        scope,
        key,
        definition.method,
        paramsResult.data,
      );
      if (cached.status === "hit") return protocolJson(cached.message);
      if (cached.status === "conflict") {
        return this.error(
          message.id,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with different params",
          409,
        );
      }
    }

    try {
      const result = await handleProtocolMethod(
        this.state,
        definition.method,
        paramsResult.data,
      );
      const resultParsed = definition.resultSchema.parse(result);
      const response = createProtocolMessage(
        "response",
        {
          ok: true,
          method: definition.method,
          result: resultParsed,
          cursor:
            resultParsed &&
            typeof resultParsed === "object" &&
            "cursor" in resultParsed
              ? (resultParsed as { cursor?: unknown }).cursor
              : undefined,
        },
        {
          source: orchestratorSource(this.state.daemonId),
          replyTo: message.id,
          correlationId: message.id,
        },
      );
      if (key && definition.idempotency !== "none") {
        this.idempotency.store(
          scope,
          key,
          definition.method,
          paramsResult.data,
          response,
        );
      }
      return protocolJson(response);
    } catch (error) {
      const response = this.errorFromException(message.id, error);
      if (key && definition.idempotency !== "none") {
        const envelope = (await response.clone().json()) as NerveMessage;
        this.idempotency.store(
          scope,
          key,
          definition.method,
          paramsResult.data,
          envelope,
        );
      }
      return response;
    }
  }

  private errorFromException(
    replyTo: string | undefined,
    error: unknown,
  ): Response {
    if (error instanceof HttpError) {
      const code = mapHttpCode(error.code);
      return this.error(replyTo, code, error.message, error.status);
    }
    if (error instanceof GitWorkflowError) {
      const code = mapHttpCode(error.code);
      return this.error(replyTo, code, error.message, error.status);
    }
    if (error instanceof ZodError) {
      return this.error(
        replyTo,
        "VALIDATION_FAILED",
        "Protocol response validation failed",
        500,
        false,
        error.flatten(),
      );
    }
    return this.error(
      replyTo,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : String(error),
      500,
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
