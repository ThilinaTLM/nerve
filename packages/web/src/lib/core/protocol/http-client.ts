import {
  type NerveMessage,
  nerveMessageSchema,
  type ProtocolMethodName,
  protocolResponseMessageSchema,
  type SnapshotCursor,
} from "@nervekit/shared";
import {
  ApiRequestError,
  normalizeApiPathForFetch,
} from "$lib/core/api/client";
import { protocolClientId, protocolInstanceId } from "$lib/core/protocol/ids";
import { createClientMessage } from "$lib/core/protocol/messages";

export class ProtocolRequestError extends ApiRequestError {
  constructor(
    status: number | undefined,
    code: string | undefined,
    message: string,
    readonly recovery?: unknown,
  ) {
    super(status, code, message);
    this.name = "ProtocolRequestError";
  }
}

export async function protocolRequest<T>(
  method: ProtocolMethodName,
  params?: unknown,
  options: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<{ result: T; cursor?: SnapshotCursor }> {
  const request = createClientMessage(
    "request",
    {
      method,
      params,
      idempotencyKey: options.idempotencyKey,
      timeoutMs: options.timeoutMs,
    },
    {
      role: "ui",
      id: protocolClientId(),
      instanceId: protocolInstanceId(),
      name: "Nerve Web UI",
    },
  );
  const response = await fetch(normalizeApiPathForFetch("/api/protocol/v1"), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/vnd.nerve.protocol.v1+json",
      accept: "application/vnd.nerve.protocol.v1+json, application/json",
    },
    body: JSON.stringify(request),
  });
  const raw = (await response.json()) as unknown;
  const envelope = nerveMessageSchema.parse(raw) as NerveMessage;
  if (envelope.kind === "error") {
    const data = envelope.data as {
      code?: string;
      message?: string;
      recovery?: unknown;
    };
    throw new ProtocolRequestError(
      response.status,
      data.code,
      data.message ?? "Protocol request failed",
      data.recovery,
    );
  }
  const parsed = protocolResponseMessageSchema.parse(envelope);
  if (!response.ok) {
    throw new ProtocolRequestError(
      response.status,
      undefined,
      "Protocol request failed",
    );
  }
  if (parsed.data.method !== method) {
    throw new ProtocolRequestError(
      response.status,
      "INVALID_MESSAGE",
      "Protocol response method did not match request",
    );
  }
  return {
    result: parsed.data.result as T,
    cursor: parsed.data.cursor as SnapshotCursor | undefined,
  };
}
