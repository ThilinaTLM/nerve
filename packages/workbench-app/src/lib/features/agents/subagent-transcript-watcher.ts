import type { EventEnvelope } from "@nervekit/contracts/events";
import {
  isSequencedEvent,
  onAnyEvent,
} from "$lib/application/events/event-bus";
import type { SubagentTranscriptObserver } from "$lib/presentation/context.svelte";
import { getSubagentTranscript } from "./api/subagent-transcripts.api";
import type { WorkbenchEventHandler } from "$lib/application/events/event-bus";
import type { SubagentTranscriptSnapshot } from "@nervekit/contracts/agents";

const TRANSCRIPT_PREFIX = "agent.subagent_transcript.";
const EXPLORE_TERMINAL_EVENT = "agent.subagent_transcript.run.completed";
/** Canonical run lifecycle events published by async teammates' own runs. */
const CANONICAL_RUN_EVENTS = new Set([
  "run.started",
  "run.completed",
  "run.cancelled",
  "run.failed",
  "run.suspended",
  "run.resumed",
  "run.retrying",
]);
const CANONICAL_TERMINAL_EVENTS = new Set([
  "run.completed",
  "run.cancelled",
  "run.failed",
]);

type BufferedEvent = EventEnvelope<Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function isCanonicalChildEventType(type: string): boolean {
  return (
    CANONICAL_RUN_EVENTS.has(type) ||
    type.startsWith("conversation.live.") ||
    type === "conversation.entry.appended" ||
    type === "toolCall.updated"
  );
}

/**
 * Explore children publish the dedicated transcript family; async teammates
 * publish canonical conversation events on the shared stream. Both are
 * filtered to the child here, before the session normalizes sequence numbers,
 * so lead and sibling traffic can never reach the child timeline.
 */
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
      (data.projectId !== undefined && data.projectId !== expected.projectId))
  )
    return false;
  if (event.type.startsWith(TRANSCRIPT_PREFIX)) {
    return (
      data.parentAgentId === parentAgentId && data.childAgentId === childAgentId
    );
  }
  if (!isCanonicalChildEventType(event.type)) return false;
  const agentId = data.agentId ?? record(data.entry)?.agentId;
  return agentId === childAgentId;
}

function isTerminal(event: BufferedEvent): boolean {
  return (
    event.type === EXPLORE_TERMINAL_EVENT ||
    CANONICAL_TERMINAL_EVENTS.has(event.type)
  );
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
      // Teammates are persistent: each new run gets its own final reconcile.
      if (
        event.type === "run.started" ||
        event.type === "agent.subagent_transcript.run.started"
      )
        terminalReconciled = false;
      if (observer.event(event) === false) requestReconcile();
      if (isTerminal(event) && !terminalReconciled) {
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
