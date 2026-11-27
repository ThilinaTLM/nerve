import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

/*
 * Web Push: a paired device subscribes once; the daemon pushes the same
 * attention edges the app shows, but only when nobody is at a screen. See
 * docs/architecture/conversation-state-and-attention.md (Web Push).
 */

/** The browser's `PushSubscription.toJSON()`, reduced to what sending needs. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionData = z.infer<typeof pushSubscriptionSchema>;

/** `GET /api/access/push`: the VAPID key and whether this device subscribed. */
export const pushStateSchema = z.object({
  /** Base64url VAPID public key for `pushManager.subscribe`. */
  publicKey: z.string(),
  subscribed: z.boolean(),
});
export type PushState = z.infer<typeof pushStateSchema>;

/**
 * What the service worker receives. Deliberately small: no transcript,
 * tool arguments or paths. The worker writes the notification text.
 */
export const pushPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("attention"),
    conversationId: z.string(),
    /** The conversation to open: a sub-agent's own when it is asking. */
    openConversationId: z.string(),
    reason: z.enum(["input", "finished", "failed", "interrupted"]),
    inputKind: z
      .enum(["approval", "user_input", "plan_review", "configuration_blocked"])
      .optional(),
    conversationTitle: z.string(),
    projectName: z.string().optional(),
    /** Set when a sub-agent, not the lead, needs the input. */
    subAgentTitle: z.string().optional(),
  }),
  z.object({ type: z.literal("test") }),
]);
export type PushPayload = z.infer<typeof pushPayloadSchema>;

/**
 * Each connected app reports whether someone is using it and whether it is
 * muted. The daemon pushes only when no client is active and none is muted;
 * reports end with the connection.
 */
export const clientPresenceSchema = z.object({
  /** Focused with recent input (the app's "watching" or "elsewhere"). */
  active: z.boolean(),
  muted: z.boolean(),
});
export type ClientPresence = z.infer<typeof clientPresenceSchema>;

export const accessOperationDefinitions = [
  defineOperation(
    "access.presence.report",
    clientPresenceSchema,
    z.object({ ok: z.literal(true) }),
    "mutation",
    ["workbench_server"] as const,
    "operation.access.presence.report",
    { invocationScope: "session" },
  ),
] as const;
