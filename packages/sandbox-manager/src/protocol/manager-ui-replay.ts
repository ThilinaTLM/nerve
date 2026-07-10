import type {
  NerveMessage,
  ReplayRequestData,
  StreamState,
} from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { MANAGER_EVENT_STREAM } from "../events/manager-events.js";
import { managerEventBatch } from "./manager-protocol-event-batch.js";
import {
  makeManagerMessage,
  type UiProtocolSession,
} from "./manager-protocol-session.js";
import { replayEvents } from "./replay.js";

export async function uiWelcomeStreams(
  state: ManagerState,
  streams: string[],
): Promise<StreamState[]> {
  const unique = Array.from(new Set(streams));
  return Promise.all(
    unique.map(async (stream) => {
      const storeId = storeIdForUiStream(stream);
      const events = storeId ? await state.events.list(storeId) : [];
      const latestSeq = Math.max(0, ...events.map((event) => event.seq ?? 0));
      const durableSeq = Math.max(
        0,
        ...events
          .filter((event) => event.durability !== "transient")
          .map((event) => event.seq ?? 0),
      );
      const durableAvailable = events
        .filter((event) => event.durability !== "transient")
        .map((event) => event.seq ?? 0)
        .filter((seq) => seq > 0);
      return {
        stream,
        latestSeq,
        durableSeq,
        replayAvailableFromSeq: durableAvailable.length
          ? Math.min(...durableAvailable) - 1
          : 0,
      };
    }),
  );
}

export async function handleUiReplayRequest(
  state: ManagerState,
  session: UiProtocolSession,
  request: ReplayRequestData,
  send: (message: NerveMessage<unknown>) => void,
): Promise<void> {
  if (request.sessionId !== session.sessionId) {
    send(
      makeManagerMessage("replay.unavailable", {
        sessionId: session.sessionId,
        replayId: request.replayId,
        streams: request.streams.map((stream) => ({
          stream: stream.stream,
          requestedFromSeq: stream.fromSeq,
          latestSeq: 0,
          reason: "snapshot_required" as const,
        })),
        recovery: { action: "load_snapshot" as const },
      }),
    );
    return;
  }
  session.replay.activeReplayIds.add(request.replayId);
  for (const stream of request.streams)
    session.subscribedStreams.add(stream.stream);
  const streamStates = await Promise.all(
    request.streams.map(async (streamRequest) => {
      const storeId = storeIdForUiStream(streamRequest.stream);
      const allEvents = storeId
        ? await replayEvents(state.events, storeId, 0)
        : [];
      const latestSeq = Math.max(
        0,
        ...allEvents.map((event) => event.seq ?? 0),
      );
      const durableEvents = allEvents.filter(
        (event) => event.durability !== "transient",
      );
      const earliestDurableSeq = Math.min(
        ...durableEvents.map((event) => event.seq ?? Number.POSITIVE_INFINITY),
      );
      return {
        streamRequest,
        storeId,
        durableEvents,
        latestSeq,
        earliestDurableSeq,
      };
    }),
  );
  const unavailable = streamStates.filter(
    ({ streamRequest, storeId, latestSeq, earliestDurableSeq }) =>
      !storeId ||
      streamRequest.fromSeq > latestSeq ||
      (Number.isFinite(earliestDurableSeq) &&
        streamRequest.fromSeq < earliestDurableSeq - 1),
  );
  if (unavailable.length) {
    send(
      makeManagerMessage("replay.unavailable", {
        sessionId: session.sessionId,
        replayId: request.replayId,
        streams: unavailable.map(
          ({ streamRequest, storeId, latestSeq, earliestDurableSeq }) => ({
            stream: streamRequest.stream,
            requestedFromSeq: streamRequest.fromSeq,
            earliestAvailableSeq: Number.isFinite(earliestDurableSeq)
              ? earliestDurableSeq
              : undefined,
            latestSeq,
            reason: !storeId
              ? ("stream_not_found" as const)
              : streamRequest.fromSeq > latestSeq
                ? ("cursor_ahead_of_server" as const)
                : ("cursor_too_old" as const),
          }),
        ),
        recovery: {
          action: "load_snapshot" as const,
          snapshotMethod: unavailable.some(
            ({ streamRequest }) =>
              streamRequest.stream === MANAGER_EVENT_STREAM,
          )
            ? "sandbox.manager.status.get"
            : "sandbox.conversation.snapshot.get",
        },
      }),
    );
    return;
  }
  sendReplayStarted(session, request, streamStates, send);
  for (const { streamRequest, durableEvents, latestSeq } of streamStates) {
    const events = replaySlice(durableEvents, streamRequest).slice(
      0,
      request.preferences?.maxEvents ?? 1_000,
    );
    const batch = managerEventBatch({
      stream: streamRequest.stream,
      batchId: `replay_${request.replayId}_${streamRequest.stream}`,
      reason: "replay",
      events,
      previousDurableSeq: streamRequest.fromSeq,
      replay: {
        replayId: request.replayId,
        fromSeq: streamRequest.fromSeq,
        toSeq: streamRequest.toSeq ?? latestSeq,
        complete: events.length < (request.preferences?.maxEvents ?? 1_000),
      },
    });
    send(makeManagerMessage("event.batch", batch));
    const durableLast = batch.range.durableLastSeq;
    if (typeof durableLast === "number")
      session.latestSentSeqs.set(streamRequest.stream, durableLast);
  }
  sendReplayComplete(session, request, streamStates, send);
  session.replay.activeReplayIds.delete(request.replayId);
}

type UiReplayStreamState = Awaited<
  ReturnType<
    typeof Promise.all<
      Array<{
        streamRequest: ReplayRequestData["streams"][number];
        storeId: string | undefined;
        durableEvents: Awaited<ReturnType<typeof replayEvents>>;
        latestSeq: number;
        earliestDurableSeq: number;
      }>
    >
  >
>[number];

function sendReplayStarted(
  session: UiProtocolSession,
  request: ReplayRequestData,
  streamStates: UiReplayStreamState[],
  send: (message: NerveMessage<unknown>) => void,
): void {
  send(
    makeManagerMessage("replay.started", {
      sessionId: session.sessionId,
      replayId: request.replayId,
      streams: streamStates.map(
        ({ streamRequest, latestSeq, durableEvents }) => ({
          stream: streamRequest.stream,
          fromSeq: streamRequest.fromSeq,
          toSeq: streamRequest.toSeq ?? latestSeq,
          latestSeq,
          durableFromSeq: durableEvents.find(
            (event) => (event.seq ?? 0) > streamRequest.fromSeq,
          )?.seq,
          durableToSeq: durableEvents.at(-1)?.seq,
          estimatedEvents: replaySlice(durableEvents, streamRequest).length,
          source: "log" as const,
          transientPolicy: "omitted" as const,
        }),
      ),
    }),
  );
}

function sendReplayComplete(
  session: UiProtocolSession,
  request: ReplayRequestData,
  streamStates: UiReplayStreamState[],
  send: (message: NerveMessage<unknown>) => void,
): void {
  send(
    makeManagerMessage("replay.complete", {
      sessionId: session.sessionId,
      replayId: request.replayId,
      streams: streamStates.map(
        ({ streamRequest, durableEvents, latestSeq }) => {
          const sent = replaySlice(durableEvents, streamRequest);
          return {
            stream: streamRequest.stream,
            fromSeq: streamRequest.fromSeq,
            toSeq: streamRequest.toSeq ?? latestSeq,
            latestSeq,
            durableCompleteThroughSeq:
              sent.at(-1)?.seq ?? streamRequest.fromSeq,
            sentEvents: sent.length,
            sentDurableEvents: sent.length,
            sentTransientEvents: 0,
          };
        },
      ),
      liveDelivery: "continued" as const,
    }),
  );
}

function replaySlice(
  events: Awaited<ReturnType<typeof replayEvents>>,
  streamRequest: ReplayRequestData["streams"][number],
) {
  return events.filter(
    (event) =>
      (event.seq ?? 0) > streamRequest.fromSeq &&
      (event.seq ?? 0) <= (streamRequest.toSeq ?? Number.MAX_SAFE_INTEGER),
  );
}

function storeIdForUiStream(stream: string): string | undefined {
  if (stream === MANAGER_EVENT_STREAM) return "__manager__";
  if (stream.startsWith("sandbox:")) return stream.slice("sandbox:".length);
  return undefined;
}
