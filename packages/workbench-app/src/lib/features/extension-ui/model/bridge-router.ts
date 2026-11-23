import {
  bridgeEventKinds,
  bridgeEvents,
  bridgeFrameMessageSchema,
  bridgeLimits,
  bridgeProtocolVersion,
  serverBridgeMethods,
  validateBridgeRequest,
  type BridgeContributionKind,
  type BridgeErrorCode,
  type BridgeEventName,
  type BridgeFrameError,
  type BridgeMethodName,
} from "@nervekit/contracts/extensions";

/** What a frame is: the contribution that owns it, as far as the bridge cares. */
export type FrameContribution = {
  kind: BridgeContributionKind;
  id: string;
  edit?: "source" | "custom" | "none";
};

export type BridgeFailure = { code: BridgeErrorCode; message: string };

/** A request the host answers with a specific bridge error. */
export class HostFailure extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** What the host does with one message posted by a frame. */
export type RoutedFrameMessage =
  | { type: "ignore" }
  | { type: "ready" }
  | { type: "frameError"; error: BridgeFrameError }
  | { type: "reject"; id: string; error: BridgeFailure }
  | {
      type: "request";
      id: string;
      method: BridgeMethodName;
      params: unknown;
      /** `host` methods are answered by the app, `server` methods by the daemon. */
      handler: "host" | "server";
    };

const encoder = new TextEncoder();

/** Serialized size of a message in bytes; `undefined` when it is not plain JSON. */
export function messageBytes(data: unknown): number | undefined {
  try {
    const json = JSON.stringify(data);
    return json === undefined ? undefined : encoder.encode(json).length;
  } catch {
    return undefined;
  }
}

/** The request id of a malformed message, when it carries one to answer. */
function requestIdOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const { type, id } = data as { type?: unknown; id?: unknown };
  return type === "request" &&
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= bridgeLimits.maxRequestIdLength
    ? id
    : undefined;
}

export function bridgeMethodHandler(
  method: BridgeMethodName,
): "host" | "server" {
  return (serverBridgeMethods as readonly string[]).includes(method)
    ? "server"
    : "host";
}

/**
 * Validates one message from a frame (the caller already checked that its source is the
 * frame's window): size, envelope, then method availability and params for the contribution.
 */
export function routeFrameMessage(
  data: unknown,
  contribution: FrameContribution,
): RoutedFrameMessage {
  const bytes = messageBytes(data);
  if (bytes === undefined) return { type: "ignore" };
  if (bytes > bridgeLimits.maxMessageBytes) {
    const id = requestIdOf(data);
    return id
      ? {
          type: "reject",
          id,
          error: { code: "too_large", message: "The message is too large" },
        }
      : { type: "ignore" };
  }
  const envelope = bridgeFrameMessageSchema.safeParse(data);
  if (!envelope.success) {
    const id = requestIdOf(data);
    return id
      ? {
          type: "reject",
          id,
          error: {
            code: "invalid_request",
            message: "The request is not a valid bridge message",
          },
        }
      : { type: "ignore" };
  }
  if (envelope.data.type === "ready") return { type: "ready" };
  if (envelope.data.type === "frameError")
    return { type: "frameError", error: envelope.data.error };
  const validated = validateBridgeRequest(envelope.data, contribution);
  if (!validated.ok)
    return { type: "reject", id: envelope.data.id, error: validated.error };
  return {
    type: "request",
    id: envelope.data.id,
    method: validated.method,
    params: validated.params,
    handler: bridgeMethodHandler(validated.method),
  };
}

export function okResponse(id: string, result: unknown) {
  return {
    nerveBridge: bridgeProtocolVersion,
    type: "response" as const,
    id,
    ok: true as const,
    result,
  };
}

export function errorResponse(
  id: string,
  code: BridgeErrorCode,
  message: string,
) {
  return {
    nerveBridge: bridgeProtocolVersion,
    type: "response" as const,
    id,
    ok: false as const,
    error: { code, message: message.slice(0, 2000) },
  };
}

/** The envelope of a host event, or `undefined` when this kind of frame does not get it or `data` is invalid. */
export function eventMessage<E extends BridgeEventName>(
  event: E,
  data: unknown,
  kind: BridgeContributionKind,
) {
  if (!bridgeEventKinds[event].includes(kind)) return undefined;
  const parsed = bridgeEvents[event].safeParse(data);
  if (!parsed.success) return undefined;
  return {
    nerveBridge: bridgeProtocolVersion,
    type: "event" as const,
    event,
    data: parsed.data,
  };
}

const bridgeErrorCodes: readonly string[] = [
  "invalid_request",
  "not_allowed",
  "unknown_method",
  "not_found",
  "too_large",
  "cancelled",
  "conflict",
  "backend_error",
  "failed",
];

/** Maps whatever a server request threw to the error a frame sees. */
export function failureOf(
  error: unknown,
  method: BridgeMethodName,
): BridgeFailure {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  const message =
    error instanceof Error ? error.message : String(error ?? "Request failed");
  if (typeof code === "string" && bridgeErrorCodes.includes(code))
    return { code: code as BridgeErrorCode, message: message.slice(0, 2000) };
  return {
    code: method === "backend.call" ? "backend_error" : "failed",
    message: message.slice(0, 2000),
  };
}
