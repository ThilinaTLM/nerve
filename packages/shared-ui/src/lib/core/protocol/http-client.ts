import {
  type NerveMessage,
  nerveMessageSchema,
  type PeerDescriptor,
  type ProtocolMethodName,
  protocolResponseMessageSchema,
  type SnapshotCursor,
} from "@nervekit/shared";
import { ApiRequestError, normalizeApiPathForFetch } from "../api/client.js";
import { protocolClientId, protocolInstanceId } from "./ids.js";
import { createClientMessage } from "./messages.js";

export const NERVE_PROTOCOL_V1_MEDIA_TYPE =
  "application/vnd.nerve.protocol.v1+json";

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

export interface ProtocolRequestOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
  apiPath?: string;
  sourceName?: string;
  source?: Partial<PeerDescriptor>;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
}

export async function protocolRequest<T>(
  method: ProtocolMethodName,
  params?: unknown,
  options: ProtocolRequestOptions = {},
): Promise<{ result: T; cursor?: SnapshotCursor }> {
  const source: PeerDescriptor = {
    role: "ui",
    id: options.source?.id ?? protocolClientId(),
    instanceId: options.source?.instanceId ?? protocolInstanceId(),
    name: options.sourceName ?? options.source?.name ?? "Nerve UI",
    ...options.source,
  };
  const request = createClientMessage(
    "request",
    {
      method,
      params,
      idempotencyKey: options.idempotencyKey,
      timeoutMs: options.timeoutMs,
    },
    source,
  );
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    normalizeApiPathForFetch(options.apiPath ?? "/api/protocol/v1"),
    {
      method: "POST",
      credentials: options.credentials ?? "same-origin",
      headers: {
        "content-type": NERVE_PROTOCOL_V1_MEDIA_TYPE,
        accept: `${NERVE_PROTOCOL_V1_MEDIA_TYPE}, application/json`,
      },
      body: JSON.stringify(request),
    },
  );
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
