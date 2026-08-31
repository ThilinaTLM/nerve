import {
  nerveMessageSchema,
  parseProtocolResponseData,
  protocolResponseMessageSchema,
  type NerveMessage,
  type PeerDescriptor,
} from "@nervekit/contracts/wire";
import {
  type OperationName,
  type OperationParams,
  type OperationResult,
} from "@nervekit/contracts/operations";
import { type SnapshotCursor } from "@nervekit/contracts/snapshots";
import { protocolClientId, protocolInstanceId } from "./browser-id-store.js";
import { createMessageFactory } from "../messages/message-factory.js";
import { prepareOperationRequest } from "../rpc/operation-request.js";

export const NERVE_PROTOCOL_V1_MEDIA_TYPE =
  "application/vnd.nerve.protocol.v1+json";

export class ProtocolRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly code: string | undefined,
    message: string,
    readonly recovery?: unknown,
  ) {
    super(message);
    this.name = "ProtocolRequestError";
  }
}

export interface ProtocolRequestOptions {
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly apiPath?: string;
  readonly sourceName?: string;
  readonly source?: Partial<PeerDescriptor>;
  readonly target?: PeerDescriptor;
  readonly fetch?: typeof globalThis.fetch;
  readonly credentials?: RequestCredentials;
}

export async function protocolRequest<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  options: ProtocolRequestOptions = {},
): Promise<{ result: OperationResult<M>; cursor?: SnapshotCursor }> {
  const source: PeerDescriptor = {
    role: "ui",
    id: options.source?.id ?? protocolClientId(),
    instanceId: options.source?.instanceId ?? protocolInstanceId(),
    name: options.sourceName ?? options.source?.name ?? "Nerve UI",
    ...options.source,
  };
  const target = options.target ?? { role: "workbench_server" };
  const prepared = prepareOperationRequest(method, params, {
    target,
    idempotencyKey: options.idempotencyKey,
    timeoutMs: options.timeoutMs,
  });
  if (!prepared.ok) {
    throw new ProtocolRequestError(
      undefined,
      prepared.error.code,
      prepared.error.message,
    );
  }
  const request = createMessageFactory({ source, target })(
    "request",
    prepared.data,
  );
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(
    normalizeApiPath(options.apiPath ?? "/api/protocol/v1"),
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
  const data = parseProtocolResponseData(method, parsed.data);
  return {
    result: data.result,
    cursor: data.cursor as SnapshotCursor | undefined,
  };
}

function normalizeApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof globalThis.location === "undefined") return path;
  return new URL(path, globalThis.location.origin).toString();
}
