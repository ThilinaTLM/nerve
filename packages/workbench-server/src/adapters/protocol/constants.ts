import {
  WORKSPACE_STREAM,
  conversationStream,
} from "@nervekit/contracts/events";

export const PROTOCOL_SESSION_LIMITS = {
  maxMessageBytes: 4 * 1024 * 1024,
  maxBatchEvents: 500,
  maxBatchBytes: 1024 * 1024,
} as const;

export const PROTOCOL_HEARTBEAT = {
  intervalMs: 30_000,
  timeoutMs: 70_000,
} as const;

export { WORKSPACE_STREAM, conversationStream };
