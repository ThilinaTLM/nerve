import type {
  ManagedContainerStatus,
  ManagedSandboxRecord,
  SandboxRuntimeContainerStatus,
} from "@nervekit/shared";
import type { ManagerState } from "../app/manager-state.js";
import { lifecycleSummary } from "../lifecycle/lifecycle-state.js";
import { refreshSandboxObservedState } from "../lifecycle/reconciler.js";
import {
  readAgentStateSummary,
  setupSummaryFailure,
} from "../state/agent-state-summary.js";
import type { SandboxSessionRecord } from "../state/session-store.js";
import { projectSandboxSummariesFromEvents } from "./conversation-event-projection.js";

export type DerivedSandboxView = {
  record: ManagedSandboxRecord;
  status: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  container?: SandboxRuntimeContainerStatus;
};

export async function deriveSandboxContainerStatus(
  state: ManagerState,
  storedRecord: ManagedSandboxRecord,
): Promise<{
  record: ManagedSandboxRecord;
  container?: SandboxRuntimeContainerStatus;
}> {
  if (!storedRecord.containerRef) return { record: storedRecord };
  const observedAt = new Date().toISOString();
  const refreshed = await refreshSandboxObservedState(
    state.sandboxes,
    state.driver,
    storedRecord,
  );
  const inspected = await inspectContainerSafely(state, refreshed);
  const limitations = mergeLimitations(inspected?.limitations, undefined)?.map(
    redactText,
  );
  return {
    record: refreshed,
    container: {
      ref: refreshed.containerRef,
      runtime: refreshed.containerRef?.kind ?? refreshed.backend,
      state: inspected?.state ?? refreshed.observedState,
      lifecycle: lifecycleSummary(refreshed),
      health: inspected?.health,
      exitCode: inspected?.exitCode,
      startedAt: inspected?.startedAt ?? refreshed.startedAt,
      finishedAt: inspected?.finishedAt ?? refreshed.stoppedAt,
      observedAt,
      lastError: refreshed.lastError
        ? {
            code: refreshed.lastError.code,
            message: refreshed.lastError.message,
          }
        : undefined,
      limitations,
    },
  };
}

export async function managerDerivedSandboxView(
  state: ManagerState,
  sandboxId: string,
): Promise<DerivedSandboxView | undefined> {
  const storedRecord = await state.sandboxes.get(sandboxId);
  if (!storedRecord) return undefined;
  const { record, container } = await deriveSandboxContainerStatus(
    state,
    storedRecord,
  );
  const session = await state.sessions.get(sandboxId);
  const events = await state.events.list(sandboxId);
  const agentSummary = await readAgentStateSummary(record);
  const lastEvent = events
    .filter((event) => typeof event.seq === "number" || event.ts)
    .sort((a, b) => Number(a.seq ?? -1) - Number(b.seq ?? -1))
    .at(-1);
  const latestSeq = Math.max(
    lastEvent?.seq ?? -1,
    agentSummary?.lastEventSeq ?? -1,
  );
  const startupFailure =
    agentSummary?.startupFailure?.error ??
    setupSummaryFailure(agentSummary?.setup);
  const now = new Date().toISOString();
  const disconnectedAt = session?.disconnectedAt ?? record.stoppedAt;
  const status = startupFailure
    ? "failed"
    : daemonStatusFromRecord(record, session?.state);
  const summaries = projectSandboxSummariesFromEvents({ sandboxId, events });
  const stalenessReason = managerStalenessReason(record, container, session);
  const limitations = managerDerivedLimitations(
    status,
    stalenessReason,
    agentSummary?.startupFailure?.stage,
  );
  const base = {
    sandboxId: record.sandboxId,
    instanceId: record.instanceId ?? "unknown",
    status,
    connected: false,
    stale: true,
    staleness: {
      stale: true,
      reason: stalenessReason,
      asOf: now,
      lastConnectedAt: session?.updatedAt,
      disconnectedAt,
      ageMs: disconnectedAt
        ? Math.max(0, Date.now() - Date.parse(disconnectedAt))
        : undefined,
    },
    lastEventSeq: latestSeq >= 0 ? latestSeq : undefined,
    lastEventAt: agentSummary?.lastEventAt ?? lastEvent?.ts,
    lastSession: sessionSummary(session),
    limitations,
    lifecycle: lifecycleSummary(record),
    container,
    configDigest: record.configDigest,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    setup: agentSummary?.setup,
    setupTimeline: agentSummary?.setupTimeline,
    connectivity: {
      state:
        session?.state === "reconnecting" ? "reconnecting" : "disconnected",
      connectedAt: session?.updatedAt,
      disconnectedAt,
      lastErrorCode: record.lastError?.code,
      lastError: record.lastError
        ? { code: record.lastError.code, message: record.lastError.message }
        : undefined,
    },
    cursors: cursorSummary(session?.cursors),
    conversations: summaries.conversations,
    agents: summaries.agents,
    runs: summaries.runs,
  } satisfies Record<string, unknown>;

  const eventSeq = lastEvent?.seq;
  const replayCursorSeq = Math.max(latestSeq, eventSeq ?? -1, 0);
  return {
    record,
    container,
    status: base,
    snapshot: {
      ...base,
      replayCursors: cursorSummary(session?.cursors)?.streams ?? [
        {
          stream: `sandbox:${sandboxId}`,
          processedSeq: replayCursorSeq,
        },
      ],
      lastEventSeq:
        latestSeq < 0 && eventSeq === undefined
          ? undefined
          : Math.max(latestSeq, eventSeq ?? -1),
      lastEventAt: base.lastEventAt ?? lastEvent?.ts,
    },
  };
}

export function daemonStatusFromRecord(
  record: ManagedSandboxRecord,
  sessionState?: string,
): "booting" | "reconnecting" | "stopping" | "failed" | "offline" {
  if (record.lifecycleState === "failed") return "failed";
  if (record.lifecycleState === "stopping") return "stopping";
  if (
    record.lifecycleState === "stopped" ||
    record.lifecycleState === "removed"
  )
    return "offline";
  if (record.lifecycleState === "reconnecting") return "reconnecting";
  if (
    record.lifecycleState === "record_created" ||
    record.lifecycleState === "container_creating" ||
    record.lifecycleState === "container_created" ||
    record.lifecycleState === "container_starting" ||
    record.lifecycleState === "container_started" ||
    record.lifecycleState === "daemon_connected" ||
    record.lifecycleState === "booting"
  )
    return "booting";
  if (record.observedState === "failed") return "failed";
  if (record.observedState === "stopping") return "stopping";
  if (
    record.observedState === "exited" ||
    record.observedState === "removed" ||
    record.desiredState === "stopped" ||
    record.desiredState === "removed"
  )
    return "offline";
  if (
    record.observedState === "creating" ||
    record.observedState === "starting"
  )
    return "booting";
  if (sessionState === "reconnecting") return "reconnecting";
  if (record.observedState === "running") return "reconnecting";
  return "reconnecting";
}

export function managerStalenessReason(
  record: ManagedSandboxRecord,
  container: SandboxRuntimeContainerStatus | undefined,
  session: SandboxSessionRecord | undefined,
): string {
  const state = container?.state ?? record.observedState;
  if (record.lifecycleState === "container_started")
    return "daemon_not_connected";
  if (
    record.lifecycleState === "daemon_connected" ||
    record.lifecycleState === "booting"
  )
    return "sandbox_booting";
  if (state === "removed" || record.desiredState === "removed")
    return "container_removed";
  if (
    state === "failed" ||
    record.observedState === "failed" ||
    record.lifecycleState === "failed"
  )
    return "container_failed";
  if (state === "exited" || record.desiredState === "stopped")
    return "container_stopped";
  return session ? "controller_disconnected" : "no_controller_session";
}

function managerDerivedLimitations(
  status: string,
  reason: string,
  failedStage?: string,
): string[] {
  if (status === "offline" || reason.startsWith("container_")) {
    return [
      "The sandbox container is offline. Existing conversations are read-only snapshots until the sandbox is started or restarted.",
    ];
  }
  if (status === "failed") {
    return [
      failedStage
        ? `Sandbox startup failed during ${failedStage}. Open the container logs for the full diagnostic output.`
        : "The sandbox container failed. Existing conversations are read-only snapshots until the sandbox is restarted.",
    ];
  }
  if (status === "stopping") {
    return [
      "The sandbox is stopping. Existing conversations are read-only until it is started again.",
    ];
  }
  return [
    "Status is manager-derived because no controller session is connected",
  ];
}

function sessionSummary(session: SandboxSessionRecord | undefined) {
  if (!session) return undefined;
  return {
    sessionId: session.sessionId,
    status:
      session.state === "exited"
        ? "closed"
        : session.state === "reconnecting"
          ? "disconnected"
          : session.state,
    connectedAt: session.connectedAt ?? session.updatedAt,
    disconnectedAt: session.disconnectedAt,
    readyAt: session.readyAt,
    agentStatus: session.agentStatus,
    closeCode: session.closeCode,
    closeReason: session.closeReason?.trim() || undefined,
    acceptedCapabilities: session.capabilities,
  };
}

function cursorSummary(
  cursors: unknown,
): { streams: Array<{ stream: string; processedSeq: number }> } | undefined {
  if (
    cursors &&
    typeof cursors === "object" &&
    Array.isArray((cursors as { streams?: unknown }).streams)
  ) {
    const streams = (cursors as { streams: unknown[] }).streams
      .map((stream) => {
        if (!stream || typeof stream !== "object") return undefined;
        const record = stream as { stream?: unknown; processedSeq?: unknown };
        if (
          typeof record.stream !== "string" ||
          typeof record.processedSeq !== "number"
        )
          return undefined;
        return {
          stream: record.stream,
          processedSeq: record.processedSeq,
        };
      })
      .filter(Boolean) as Array<{ stream: string; processedSeq: number }>;
    return streams.length > 0 ? { streams } : undefined;
  }
  return undefined;
}

async function inspectContainerSafely(
  state: ManagerState,
  record: ManagedSandboxRecord,
): Promise<ManagedContainerStatus | undefined> {
  if (!record.containerRef) return undefined;
  try {
    return await state.driver.inspect(record.containerRef);
  } catch (error) {
    return {
      ref: record.containerRef,
      state: record.observedState,
      limitations: [
        redactText(error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}

function mergeLimitations(
  first: string[] | undefined,
  second: string[] | undefined,
): string[] | undefined {
  const merged = [...new Set([...(first ?? []), ...(second ?? [])])].filter(
    Boolean,
  );
  return merged.length > 0 ? merged : undefined;
}

function redactText(value: string): string {
  return value.replace(
    /(token|secret|password|api[_-]?key)=\S+/gi,
    "$1=[REDACTED]",
  );
}
