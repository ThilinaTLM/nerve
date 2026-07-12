export const PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "snapshot.workspace",
] as const;

export const REQUIRED_PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
] as const;

export const PROTOCOL_LIMITS = {
  maxMessageBytes: 4 * 1024 * 1024,
  maxBatchEvents: 500,
  maxBatchBytes: 1024 * 1024,
  maxInflightBatches: 8,
  maxUnackedDurableEvents: 10_000,
  maxReplayEvents: 10_000,
  maxReplayBytes: 4 * 1024 * 1024,
  maxQueuedDurableBeforeCatchup: 1_000,
  maxQueuedDurableBeforeResync: 10_000,
  maxQueuedTransient: 2_000,
  maxQueuedBytes: 16 * 1024 * 1024,
  transportBufferedWarningBytes: 1024 * 1024,
  transportBufferedHighBytes: 8 * 1024 * 1024,
  transportBufferedCriticalBytes: 32 * 1024 * 1024,
  clientMessagesPerWindow: 100,
  clientMessageWindowMs: 10_000,
  malformedMessageStrikes: 3,
} as const;

export const PROTOCOL_SESSION_LIMITS = {
  maxMessageBytes: PROTOCOL_LIMITS.maxMessageBytes,
  maxBatchEvents: PROTOCOL_LIMITS.maxBatchEvents,
  maxBatchBytes: PROTOCOL_LIMITS.maxBatchBytes,
  maxInflightBatches: PROTOCOL_LIMITS.maxInflightBatches,
  maxUnackedDurableEvents: PROTOCOL_LIMITS.maxUnackedDurableEvents,
} as const;

export const PROTOCOL_HEARTBEAT = {
  intervalMs: 30_000,
  timeoutMs: 70_000,
} as const;

export const GLOBAL_STREAM = "local";
