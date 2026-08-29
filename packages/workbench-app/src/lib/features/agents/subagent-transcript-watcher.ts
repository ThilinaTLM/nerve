import type { EventEnvelope } from "@nervekit/contracts";
import {
  isSequencedEvent,
  onAnyEvent,
} from "$lib/application/events/event-bus";
import type { SubagentTranscriptObserver } from "$lib/presentation/context.svelte";
import { getSubagentTranscript } from "./api/subagent-transcripts.api";
import type { WorkbenchEventHandler } from "$lib/application/events/event-bus";
import type { SubagentTranscriptSnapshot } from "@nervekit/contracts";

const TRANSCRIPT_PREFIX = "agent.subagent_transcript.";
const TERMINAL_EVENT = "agent.subagent_transcript.run.completed";

type BufferedEvent = EventEnvelope<Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function matches(
  event: BufferedEvent,
  parentAgentId: string,
  childAgentId: string,
  expected?: { conversationId: string; projectId: string },
): boolean {
  const data = record(event.data);
  if (!data) return false;
  if (
    expected &&
    (data.conversationId !== expected.conversationId ||
      data.projectId !== expected.projectId)
  )
    return false;
  if (event.type.startsWith(TRANSCRIPT_PREFIX)) {
    return (
      data.parentAgentId === parentAgentId && data.childAgentId === childAgentId
    );
  }
  return event.type === "toolCall.updated" && data.agentId === childAgentId;
}

type WatcherDependencies = {
  fetch: (
    parentAgentId: string,
    childAgentId: string,
  ) => Promise<SubagentTranscriptSnapshot>;
  subscribe: (handler: WorkbenchEventHandler) => () => void;
};

export function createSubagentTranscriptWatcher(deps: WatcherDependencies) {
  return function watchSubagentTranscriptSession(
    parentAgentId: string,
    childAgentId: string,
    observer: SubagentTranscriptObserver,
  ): () => void {
    let disposed = false;
    let hydrated = false;
    let expectedIdentity:
      | { conversationId: string; projectId: string }
      | undefined;
    let latestRelevantSeq = -1;
    let buffer: BufferedEvent[] = [];
    let refresh: Promise<void> | undefined;
    let recoveryPending = false;
    let terminalPending = false;
    let terminalReconciled = false;

    const deliver = (event: BufferedEvent) => {
      if (event.seq <= latestRelevantSeq) return;
      latestRelevantSeq = event.seq;
      if (observer.event(event) === false) requestReconcile();
      if (event.type === TERMINAL_EVENT && !terminalReconciled) {
        terminalPending = true;
        requestReconcile();
      }
    };

    const requestReconcile = () => {
      if (disposed) return;
      if (refresh) {
        recoveryPending = true;
        return;
      }
      const finalizing = terminalPending;
      refresh = deps
        .fetch(parentAgentId, childAgentId)
        .then((snapshot) => {
          if (disposed) return;
          if (
            snapshot.parentAgentId !== parentAgentId ||
            snapshot.agentId !== childAgentId
          )
            throw new Error("Subagent transcript ownership mismatch.");
          expectedIdentity = {
            conversationId: snapshot.conversationId,
            projectId: snapshot.projectId,
          };
          observer.snapshot(snapshot);
          const observedSeq = latestRelevantSeq;
          latestRelevantSeq = Math.max(latestRelevantSeq, snapshot.cursorSeq);
          if (snapshot.cursorSeq >= observedSeq) recoveryPending = false;
          if (!hydrated) {
            hydrated = true;
            const replay = buffer
              .filter(
                (event) =>
                  event.seq > snapshot.cursorSeq &&
                  matches(event, parentAgentId, childAgentId, expectedIdentity),
              )
              .sort((a, b) => a.seq - b.seq);
            buffer = [];
            for (const event of replay) deliver(event);
          }
          if (finalizing) {
            terminalPending = false;
            terminalReconciled = true;
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            observer.error(
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          refresh = undefined;
          if (recoveryPending && !disposed) {
            recoveryPending = false;
            requestReconcile();
          }
        });
    };

    const unsubscribe = deps.subscribe((candidate) => {
      if (disposed || !isSequencedEvent(candidate)) return;
      const event = candidate as BufferedEvent;
      if (!matches(event, parentAgentId, childAgentId, expectedIdentity))
        return;
      if (!hydrated) {
        buffer.push(event);
        return;
      }
      deliver(event);
    });

    requestReconcile();
    return () => {
      disposed = true;
      buffer = [];
      unsubscribe();
    };
  };
}

export const watchSubagentTranscript = createSubagentTranscriptWatcher({
  fetch: getSubagentTranscript,
  subscribe: onAnyEvent,
});
