import type { FlowMode } from "@nervekit/shared";
import { PROTOCOL_LIMITS } from "./constants.js";
import type { ProtocolSessionQueueStats } from "./session-queue.js";

export interface FlowInputs {
  currentMode: FlowMode;
  ackLag: number;
  bufferedBytes: number;
  queue: ProtocolSessionQueueStats;
  replayInProgress: boolean;
}

export interface FlowDecision {
  mode: FlowMode;
  reason:
    | "manual"
    | "replay_in_progress"
    | "ack_lag_high"
    | "transport_buffer_high"
    | "server_backpressure"
    | "transient_events_dropped"
    | "queue_limit_exceeded";
  action: "none" | "load_snapshot" | "reconnect";
}

export function decideFlow(inputs: FlowInputs): FlowDecision {
  if (
    inputs.queue.durableCount >= PROTOCOL_LIMITS.maxQueuedDurableBeforeResync ||
    inputs.queue.queuedBytes >= PROTOCOL_LIMITS.maxQueuedBytes ||
    inputs.bufferedBytes >= PROTOCOL_LIMITS.transportBufferedCriticalBytes ||
    inputs.ackLag >= PROTOCOL_LIMITS.maxUnackedDurableEvents
  ) {
    return {
      mode: "resync_required",
      reason: "queue_limit_exceeded",
      action: "load_snapshot",
    };
  }

  if (
    inputs.bufferedBytes >= PROTOCOL_LIMITS.transportBufferedHighBytes ||
    inputs.ackLag >= 2_000 ||
    inputs.queue.transientCount >= PROTOCOL_LIMITS.maxQueuedTransient
  ) {
    return {
      mode: "degraded",
      reason:
        inputs.bufferedBytes >= PROTOCOL_LIMITS.transportBufferedHighBytes
          ? "transport_buffer_high"
          : inputs.queue.transientCount >= PROTOCOL_LIMITS.maxQueuedTransient
            ? "transient_events_dropped"
            : "server_backpressure",
      action: "none",
    };
  }

  if (
    inputs.replayInProgress ||
    inputs.ackLag >= 500 ||
    inputs.queue.durableCount >= PROTOCOL_LIMITS.maxQueuedDurableBeforeCatchup
  ) {
    return {
      mode: "catching_up",
      reason: inputs.replayInProgress ? "replay_in_progress" : "ack_lag_high",
      action: "none",
    };
  }

  return { mode: "normal", reason: "manual", action: "none" };
}
