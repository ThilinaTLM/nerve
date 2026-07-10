import {
  createId,
  type EventEnvelope,
  type ReplayRequestData,
} from "@nervekit/contracts";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import type { ProtocolReplaySource } from "../infrastructure/events/event-bus.js";
import { GLOBAL_STREAM, PROTOCOL_LIMITS } from "./constants.js";

export type ReplayUnavailableReason =
  | "cursor_too_old"
  | "cursor_ahead_of_server"
  | "range_too_large"
  | "storage_unavailable";

export interface ReplayPlan {
  replayId: string;
  fromSeq: number;
  toSeq: number;
  latestSeq: number;
  source: ProtocolReplaySource;
  transientPolicy: "included_if_available" | "omitted";
  events: EventEnvelope[];
  durableFirstSeq?: number;
  durableLastSeq?: number;
  durableCount: number;
}

export type ReplayPlanResult =
  | { available: true; plan: ReplayPlan }
  | {
      available: false;
      replayId: string;
      requestedFromSeq: number;
      reason: ReplayUnavailableReason;
    };

export async function planReplay(
  state: OrchestratorState,
  request: {
    replayId?: string;
    fromSeq: number;
    toSeq?: number;
    preferences?: ReplayRequestData["preferences"];
  },
): Promise<ReplayPlanResult> {
  const replayId = request.replayId ?? createId("rpl");
  const latestSeq = state.events.latestSeq;
  const latestDurableSeq = state.events.latestDurableSeq;
  const fromSeq = request.fromSeq;
  if (fromSeq > latestDurableSeq) {
    return {
      available: false,
      replayId,
      requestedFromSeq: fromSeq,
      reason: "cursor_ahead_of_server",
    };
  }

  const toSeq = Math.min(request.toSeq ?? latestSeq, latestSeq);
  const maxReplayEvents = Math.min(
    request.preferences?.maxEvents ?? PROTOCOL_LIMITS.maxReplayEvents,
    PROTOCOL_LIMITS.maxReplayEvents,
  );
  const stats = await state.events.durableStatsBetween(fromSeq, toSeq);
  if (stats.count > maxReplayEvents) {
    return {
      available: false,
      replayId,
      requestedFromSeq: fromSeq,
      reason: "range_too_large",
    };
  }
  const continuity = await state.events.canReplayDurableRange(fromSeq, toSeq);
  if (!continuity.available) {
    return {
      available: false,
      replayId,
      requestedFromSeq: fromSeq,
      reason:
        continuity.reason === "cursor_ahead_of_server"
          ? "cursor_ahead_of_server"
          : "cursor_too_old",
    };
  }

  const replay = await state.events.replayForProtocolSince(fromSeq, {
    toSeq,
    includeTransientIfAvailable:
      request.preferences?.includeTransientIfAvailable ?? true,
  });
  const durable = replay.events.filter(
    (event) => event.durability === "durable",
  );
  return {
    available: true,
    plan: {
      replayId,
      fromSeq,
      toSeq,
      latestSeq,
      source: replay.source,
      transientPolicy:
        replay.source === "memory" ? "included_if_available" : "omitted",
      events: replay.events,
      durableFirstSeq: durable[0]?.seq,
      durableLastSeq: durable.at(-1)?.seq,
      durableCount: durable.length,
    },
  };
}

export function replayUnavailableData(
  sessionId: string,
  unavailable: Extract<ReplayPlanResult, { available: false }>,
  latestSeq: number,
  earliestAvailableSeq: number,
) {
  return {
    sessionId,
    replayId: unavailable.replayId,
    streams: [
      {
        stream: GLOBAL_STREAM,
        requestedFromSeq: unavailable.requestedFromSeq,
        earliestAvailableSeq,
        latestSeq,
        reason: unavailable.reason,
      },
    ],
    recovery: {
      action: "load_snapshot" as const,
      snapshotMethod: "snapshot.workspace.get",
    },
  };
}
