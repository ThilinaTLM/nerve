import { z } from "zod";
import { peerDescriptorSchema, typedMessageSchema } from "./envelope.schema.js";
import {
  streamCursorSchema,
  streamStateSchema,
} from "./event-stream.schema.js";

export const jsonEncodingSchema = z.literal("json");

export const batchPreferencesSchema = z
  .object({
    maxEvents: z.number().int().positive().safe().optional(),
    maxBytes: z.number().int().positive().safe().optional(),
    maxDelayMs: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
export type BatchPreferences = z.infer<typeof batchPreferencesSchema>;

export const replayPreferencesSchema = z
  .object({
    preferSnapshot: z.boolean().optional(),
    maxReplayEvents: z.number().int().positive().safe().optional(),
  })
  .strict();
export type ReplayPreferences = z.infer<typeof replayPreferencesSchema>;

export const helloDataSchema = z
  .object({
    requestedVersion: z.literal(1),
    capabilities: z.array(z.string().min(1).max(128)),
    requiredCapabilities: z.array(z.string().min(1).max(128)).optional(),
    encodings: z.array(jsonEncodingSchema).min(1),
    resume: z
      .object({
        sessionId: z.string().min(1).optional(),
        streams: z.array(streamCursorSchema).optional(),
      })
      .strict()
      .optional(),
    preferences: z
      .object({
        batch: batchPreferencesSchema.optional(),
        heartbeatIntervalMs: z.number().int().positive().safe().optional(),
        replay: replayPreferencesSchema.optional(),
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
    maxInflightBatches: z.number().int().positive().safe(),
    maxUnackedDurableEvents: z.number().int().positive().safe(),
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
    streams: z.array(streamStateSchema),
    limits: protocolLimitsSchema,
    heartbeat: z
      .object({
        intervalMs: z.number().int().positive().safe(),
        timeoutMs: z.number().int().positive().safe(),
      })
      .strict(),
    resume: z
      .object({
        accepted: z.boolean(),
        mode: z.enum(["live", "replay", "snapshot_required", "fresh"]),
        reason: z.string().min(1).max(1_024).optional(),
      })
      .strict(),
  })
  .strict();
export type WelcomeData = z.infer<typeof welcomeDataSchema>;
export const welcomeMessageSchema = typedMessageSchema(
  "welcome",
  welcomeDataSchema,
);

export const readyDataSchema = z
  .object({
    sessionId: z.string().min(1),
    streams: z.array(streamCursorSchema).optional(),
  })
  .strict();
export type ReadyData = z.infer<typeof readyDataSchema>;
export const readyMessageSchema = typedMessageSchema("ready", readyDataSchema);

export const heartbeatDataSchema = z
  .object({
    sessionId: z.string().min(1),
    sentAt: z.string().datetime(),
    processed: z.array(streamCursorSchema).optional(),
    load: z
      .object({
        eventQueueDepth: z.number().int().nonnegative().safe().optional(),
        replayQueueDepth: z.number().int().nonnegative().safe().optional(),
      })
      .strict()
      .optional(),
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
      "other",
    ]),
    message: z.string().min(1).max(1_024).optional(),
    retryAfterMs: z.number().int().nonnegative().safe().optional(),
    finalCursors: z.array(streamCursorSchema).optional(),
  })
  .strict();
export type GoodbyeData = z.infer<typeof goodbyeDataSchema>;
export const goodbyeMessageSchema = typedMessageSchema(
  "goodbye",
  goodbyeDataSchema,
);
