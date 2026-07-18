import { z } from "zod";
import { peerDescriptorSchema, typedMessageSchema } from "./envelope.schema.js";

export const STREAM_SUBSCRIPTION_CAPABILITY = "stream.subscription.v1";
export const RESYNC_REQUIRED_CLOSE_REASON = "resync_required";

export const jsonEncodingSchema = z.literal("json");

export const batchPreferencesSchema = z
  .object({
    maxEvents: z.number().int().positive().safe().optional(),
    maxBytes: z.number().int().positive().safe().optional(),
    maxDelayMs: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
export type BatchPreferences = z.infer<typeof batchPreferencesSchema>;

export const helloDataSchema = z
  .object({
    requestedVersion: z.literal(1),
    capabilities: z.array(z.string().min(1).max(128)),
    requiredCapabilities: z.array(z.string().min(1).max(128)).optional(),
    encodings: z.array(jsonEncodingSchema).min(1),
    preferences: z
      .object({
        batch: batchPreferencesSchema.optional(),
        heartbeatIntervalMs: z.number().int().positive().safe().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type HelloData = z.infer<typeof helloDataSchema>;
export const helloMessageSchema = typedMessageSchema("hello", helloDataSchema);

export const protocolLimitsSchema = z
  .object({
    maxMessageBytes: z.number().int().positive().safe(),
    maxBatchEvents: z.number().int().positive().safe(),
    maxBatchBytes: z.number().int().positive().safe(),
  })
  .strict();
export type ProtocolLimits = z.infer<typeof protocolLimitsSchema>;

export const welcomeDataSchema = z
  .object({
    sessionId: z.string().min(1),
    acceptingPeer: peerDescriptorSchema,
    acceptedVersion: z.literal(1),
    capabilities: z.array(z.string().min(1).max(128)),
    encoding: jsonEncodingSchema,
    limits: protocolLimitsSchema,
    heartbeat: z
      .object({
        intervalMs: z.number().int().positive().safe(),
        timeoutMs: z.number().int().positive().safe(),
      })
      .strict(),
  })
  .strict();
export type WelcomeData = z.infer<typeof welcomeDataSchema>;
export const welcomeMessageSchema = typedMessageSchema(
  "welcome",
  welcomeDataSchema,
);

/** Host status carried on the ready frame. */
export const readyPeerStatusSchema = z.enum(["booting", "ready", "degraded"]);
export type ReadyPeerStatus = z.infer<typeof readyPeerStatusSchema>;

export const readyDataSchema = z
  .object({
    sessionId: z.string().min(1),
    status: readyPeerStatusSchema.optional(),
  })
  .strict();
export type ReadyData = z.infer<typeof readyDataSchema>;
export const readyMessageSchema = typedMessageSchema("ready", readyDataSchema);

export const heartbeatDataSchema = z
  .object({
    sessionId: z.string().min(1),
    sentAt: z.string().datetime(),
  })
  .strict();
export type HeartbeatData = z.infer<typeof heartbeatDataSchema>;
export const heartbeatMessageSchema = typedMessageSchema(
  "heartbeat",
  heartbeatDataSchema,
);

export const goodbyeDataSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    reason: z.enum([
      "client_closing",
      "server_shutdown",
      "restart_required",
      "auth_expired",
      "protocol_error",
      "idle_timeout",
      "resync_required",
      "other",
    ]),
    message: z.string().min(1).max(1_024).optional(),
    retryAfterMs: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
export type GoodbyeData = z.infer<typeof goodbyeDataSchema>;
export const goodbyeMessageSchema = typedMessageSchema(
  "goodbye",
  goodbyeDataSchema,
);
