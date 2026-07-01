import { z } from "zod";
import { typedMessageSchema } from "./envelope.schema.js";

export const nerveErrorCodeSchema = z.enum([
  "INVALID_JSON",
  "INVALID_MESSAGE",
  "UNKNOWN_MESSAGE_KIND",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "CAPABILITY_REQUIRED",
  "CAPABILITY_NOT_NEGOTIATED",
  "MESSAGE_TOO_LARGE",
  "RATE_LIMITED",
  "SESSION_REJECTED",
  "SESSION_EXPIRED",
  "SESSION_NOT_FOUND",
  "TRANSPORT_UNAVAILABLE",
  "HEARTBEAT_TIMEOUT",
  "SERVER_SHUTTING_DOWN",
  "SERVER_BUSY",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "AUTH_FORBIDDEN",
  "ORIGIN_FORBIDDEN",
  "POLICY_DENIED",
  "REPLAY_UNAVAILABLE",
  "CURSOR_TOO_OLD",
  "CURSOR_AHEAD_OF_SERVER",
  "STREAM_NOT_FOUND",
  "EVENT_GAP_DETECTED",
  "ACK_INVALID",
  "RESYNC_REQUIRED",
  "METHOD_NOT_FOUND",
  "VALIDATION_FAILED",
  "DOMAIN_VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "OPERATION_CANCELLED",
  "OPERATION_TIMEOUT",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
]);
export type NerveErrorCode = z.infer<typeof nerveErrorCodeSchema>;

export const protocolErrorDataSchema = z.object({
  code: nerveErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  close: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  recovery: z
    .object({
      action: z.enum([
        "none",
        "retry",
        "reconnect",
        "reload",
        "load_snapshot",
        "reauthenticate",
        "contact_support",
      ]),
      retryAfterMs: z.number().int().nonnegative().safe().optional(),
      method: z.string().min(1).optional(),
    })
    .optional(),
});
export type ProtocolErrorData = z.infer<typeof protocolErrorDataSchema>;
export const protocolErrorMessageSchema = typedMessageSchema(
  "error",
  protocolErrorDataSchema,
);
