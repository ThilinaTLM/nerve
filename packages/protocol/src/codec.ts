import {
  nerveMessageSchema,
  protocolV1MessageKinds,
  protocolV1MessageSchema,
  type NerveMessage,
  type ProtocolV1Message,
} from "@nervekit/contracts";

export type DecodeFailureCode =
  | "INVALID_JSON"
  | "MESSAGE_TOO_LARGE"
  | "INVALID_MESSAGE"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "UNKNOWN_MESSAGE_KIND";

export class ProtocolDecodeError extends Error {
  constructor(
    readonly code: DecodeFailureCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ProtocolDecodeError";
  }
}

export interface ProtocolCodecOptions {
  readonly maxMessageBytes?: number;
}

export class ProtocolCodec {
  readonly #maxMessageBytes: number;

  constructor(options: ProtocolCodecOptions = {}) {
    this.#maxMessageBytes = options.maxMessageBytes ?? 1_048_576;
  }

  encode(message: ProtocolV1Message | NerveMessage): string {
    const validated = protocolV1MessageSchema.parse(message);
    const frame = JSON.stringify(validated);
    if (byteLength(frame) > this.#maxMessageBytes) {
      throw new ProtocolDecodeError(
        "MESSAGE_TOO_LARGE",
        "Protocol message exceeds the configured byte limit",
      );
    }
    return frame;
  }

  decode(frame: string): ProtocolV1Message {
    if (byteLength(frame) > this.#maxMessageBytes) {
      throw new ProtocolDecodeError(
        "MESSAGE_TOO_LARGE",
        "Protocol message exceeds the configured byte limit",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(frame);
    } catch {
      throw new ProtocolDecodeError("INVALID_JSON", "Malformed JSON frame");
    }

    const envelope = nerveMessageSchema.safeParse(value);
    if (!envelope.success) {
      const candidate = value as { protocol?: unknown; version?: unknown };
      if (candidate?.protocol === "nerve" && candidate.version !== 1) {
        throw new ProtocolDecodeError(
          "PROTOCOL_VERSION_UNSUPPORTED",
          "Only Nerve Protocol version 1 is supported",
        );
      }
      throw new ProtocolDecodeError(
        "INVALID_MESSAGE",
        "Invalid protocol envelope",
        {
          issues: envelope.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
    }
    if (!protocolV1MessageKinds.has(envelope.data.kind)) {
      throw new ProtocolDecodeError(
        "UNKNOWN_MESSAGE_KIND",
        `Unknown required message kind: ${envelope.data.kind}`,
      );
    }
    const message = protocolV1MessageSchema.safeParse(value);
    if (!message.success) {
      throw new ProtocolDecodeError(
        "INVALID_MESSAGE",
        "Invalid protocol message data",
        {
          kind: envelope.data.kind,
          issues: message.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
    }
    return message.data;
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
