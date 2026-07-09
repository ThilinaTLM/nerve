import type {
  ManagedSandboxRecord,
  StartupSetupStatus,
} from "@nervekit/shared";
import {
  sandboxContainerState,
  sandboxDaemonStatus,
  sandboxIsConnected,
  sandboxIsFailed,
  sandboxIsOffline,
  sandboxIsStopping,
  sandboxIsTerminal,
  sandboxLifecycleState,
  sandboxReadyForCommands,
} from "./sandbox-lifecycle";
import type {
  SandboxDetailState,
  SandboxSetupTimelineItem,
} from "./sandbox-ui-types";

export type BootPhaseStatus =
  | "pending"
  | "active"
  | "done"
  | "skipped"
  | "failed"
  | "degraded"
  | "stopped";

export type BootPhaseId =
  | "container"
  | "daemon"
  | "config"
  | "state"
  | "preflight"
  | "models"
  | "secrets"
  | "git"
  | "github"
  | "context"
  | "boot"
  | "skills"
  | "runtime"
  | "ready";

export type BootPhase = {
  id: BootPhaseId;
  label: string;
  description: string;
  status: BootPhaseStatus;
  ts?: string;
  error?: string;
};

export type BootState =
  | "provisioning"
  | "booting"
  | "reconnecting"
  | "ready"
  | "failed"
  | "offline";

export type SandboxBootProgress = {
  phases: BootPhase[];
  completed: number;
  total: number;
  fraction: number;
  headline: string;
  state: BootState;
  ready: boolean;
  showPhaseStepper: boolean;
};

export const isSandboxConnected = sandboxIsConnected;
export const isSandboxReadyForChat = sandboxReadyForCommands;
export const isSandboxTerminal = sandboxIsTerminal;

const STATUS_RANK: Record<BootPhaseStatus, number> = {
  pending: 0,
  active: 1,
  stopped: 2,
  degraded: 3,
  skipped: 4,
  done: 5,
  failed: 6,
};

/** Map a live setup-timeline status word to a boot-phase status. */
function fromTimelineStatus(status: string | undefined): BootPhaseStatus {
  switch (status) {
    case "completed":
      return "done";
    case "started":
      return "active";
    case "skipped":
      return "skipped";
    case "failed":
    case "timeout":
      return "failed";
    case "degraded":
      return "degraded";
    default:
      return "pending";
  }
}

/** Map a `StartupSetupStatus.status` to a boot-phase status. */
function fromSetupStatus(
  status: StartupSetupStatus["status"],
): BootPhaseStatus {
  switch (status) {
    case "completed":
      return "done";
    case "started":
      return "active";
    case "skipped":
      return "skipped";
    case "failed":
      return "failed";
    case "degraded":
      return "degraded";
    default:
      return "pending";
  }
}

function errorText(
  error: { code?: string; message: string } | undefined,
): string | undefined {
  if (!error) return undefined;
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

type PhaseInput = {
  id: BootPhaseId;
  label: string;
  description: string;
  status: BootPhaseStatus;
  ts?: string;
  error?: string;
};

/** Merge a setup-summary entry and the latest live timeline entry for a phase. */
function mergeSetupPhase(
  id: BootPhaseId,
  label: string,
  description: string,
  setup: StartupSetupStatus | undefined,
  timelineStatus: BootPhaseStatus,
  timelineTs: string | undefined,
): PhaseInput {
  const setupStatus = setup ? fromSetupStatus(setup.status) : "pending";
  const status =
    STATUS_RANK[setupStatus] >= STATUS_RANK[timelineStatus]
      ? setupStatus
      : timelineStatus;
  const ts =
    status === setupStatus
      ? (setup?.completedAt ?? setup?.startedAt ?? timelineTs)
      : (timelineTs ?? setup?.completedAt ?? setup?.startedAt);
  return { id, label, description, status, ts, error: errorText(setup?.error) };
}

export function sandboxSetupTimeline(
  detail: SandboxDetailState | undefined,
): SandboxSetupTimelineItem[] {
  if (!detail) return [];
  const byKey = new Map<string, SandboxSetupTimelineItem>();
  for (const items of [
    detail.snapshot?.setupTimeline,
    detail.status?.setupTimeline,
    detail.setupTimeline,
  ]) {
    for (const item of items ?? []) {
      const existing = byKey.get(item.key);
      if (!existing || timelineItemTime(item) >= timelineItemTime(existing))
        byKey.set(item.key, item);
    }
  }
  return [...byKey.values()];
}

function timelineItemTime(item: SandboxSetupTimelineItem): number {
  const time = Date.parse(item.completedAt ?? item.startedAt ?? item.ts);
  return Number.isFinite(time) ? time : 0;
}

function timelineItemTs(item: SandboxSetupTimelineItem): string | undefined {
  return item.completedAt ?? item.startedAt ?? item.ts;
}

/** Aggregate the latest live timeline entries for a given phase name. */
function latestTimeline(
  detail: SandboxDetailState | undefined,
  phase: string,
): { status: BootPhaseStatus; ts?: string; error?: string } {
  const items = sandboxSetupTimeline(detail).filter(
    (item) => item.phase === phase,
  );
  if (items.length === 0) return { status: "pending" };

  const failed = latestTimelineItem(
    items.filter((item) => {
      const status = fromTimelineStatus(item.status);
      return status === "failed";
    }),
  );
  if (failed)
    return {
      status: "failed",
      ts: timelineItemTs(failed),
      error: failed.error,
    };

  const active = latestTimelineItem(
    items.filter((item) => fromTimelineStatus(item.status) === "active"),
  );
  if (active) return { status: "active", ts: timelineItemTs(active) };

  const latest = latestTimelineItem(items);
  return latest
    ? { status: fromTimelineStatus(latest.status), ts: timelineItemTs(latest) }
    : { status: "pending" };
}

function latestTimelineItem(
  items: SandboxSetupTimelineItem[],
): SandboxSetupTimelineItem | undefined {
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => {
      const byTime = timelineItemTime(a.item) - timelineItemTime(b.item);
      if (byTime !== 0) return byTime;
      const byIndex = (a.item.index ?? -1) - (b.item.index ?? -1);
      if (byIndex !== 0) return byIndex;
      return a.order - b.order;
    })
    .at(-1)?.item;
}

function phaseReadyTerminal(phase: PhaseInput): boolean {
  return (
    phase.status === "done" ||
    phase.status === "skipped" ||
    phase.status === "degraded"
  );
}

export function computeSandboxBootProgress(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): SandboxBootProgress {
  const observed = sandboxContainerState(record, detail);
  const lifecycle = sandboxLifecycleState(record, detail);
  const daemon = sandboxDaemonStatus(detail);
  const connected = sandboxIsConnected(detail);
  const reconnecting =
    lifecycle === "reconnecting" ||
    daemon === "reconnecting" ||
    observed === "reconnecting";
  const readyForCommands = sandboxReadyForCommands(record, detail);
  const offline = sandboxIsOffline(record, detail);
  const stopping = sandboxIsStopping(record, detail);
  const failed = sandboxIsFailed(record, detail);
  const setup = detail?.status?.setup ?? detail?.snapshot?.setup;
  const hasBootProgress =
    Boolean(setup) || sandboxSetupTimeline(detail).length > 0;
  const setupFailed = Object.values(setup ?? {}).some(
    (phase) => phase?.status === "failed",
  );
  const hasGenericStartupTimeline = sandboxSetupTimeline(detail).some((item) =>
    [
      "state",
      "controller",
      "preflight",
      "models",
      "secrets",
      "context",
      "runtime",
    ].includes(item.phase),
  );
  const legacyImplicitStatus: BootPhaseStatus =
    setup && !hasGenericStartupTimeline ? "done" : "pending";

  const containerRunningEnough =
    lifecycle === "container_started" ||
    lifecycle === "daemon_connected" ||
    lifecycle === "booting" ||
    lifecycle === "ready" ||
    lifecycle === "degraded" ||
    observed === "running" ||
    observed === "reconnecting" ||
    connected ||
    detail?.status !== undefined ||
    detail?.snapshot !== undefined;
  const containerFailed = failed && !setupFailed;
  const container: PhaseInput = {
    id: "container",
    label: "Container",
    description: "Provision and start the sandbox container.",
    status: containerFailed
      ? "failed"
      : offline || stopping
        ? "stopped"
        : containerRunningEnough
          ? "done"
          : lifecycle === "container_creating" ||
              lifecycle === "container_created" ||
              lifecycle === "container_starting" ||
              observed === "creating" ||
              observed === "starting"
            ? "active"
            : "pending",
    error: containerFailed ? errorText(record?.lastError) : undefined,
  };

  const controllerTimeline = latestTimeline(detail, "controller");
  const daemonPhase: PhaseInput = {
    id: "daemon",
    label: "Agent connected",
    description: "Connect the sandbox agent to the manager.",
    status:
      controllerTimeline.status === "failed"
        ? "failed"
        : readyForCommands ||
              lifecycle === "booting" ||
              lifecycle === "daemon_connected" ||
              connected ||
              hasBootProgress ||
              controllerTimeline.status === "done"
          ? "done"
          : container.status === "done"
            ? "active"
            : "pending",
    ts:
      controllerTimeline.ts ??
      detail?.status?.lifecycle?.daemon?.connectedAt ??
      record?.daemon?.connectedAt,
    error: controllerTimeline.error,
  };

  const configTimeline = latestTimeline(detail, "config");
  const config: PhaseInput = {
    id: "config",
    label: "Configuration",
    description: "Load the sandbox configuration.",
    status:
      configTimeline.status !== "pending"
        ? configTimeline.status
        : container.status !== "done"
          ? "pending"
          : readyForCommands || setup || failed || daemon === "offline"
            ? "done"
            : "active",
    ts: configTimeline.ts,
    error: configTimeline.error,
  };

  const stateTimeline = latestTimeline(detail, "state");
  const statePhase: PhaseInput = {
    id: "state",
    label: "Sandbox state",
    description: "Prepare and recover the sandbox state directory.",
    status:
      stateTimeline.status === "pending"
        ? legacyImplicitStatus
        : stateTimeline.status,
    ts: stateTimeline.ts,
    error: stateTimeline.error,
  };
  const preflightTimeline = latestTimeline(detail, "preflight");
  const preflight: PhaseInput = {
    id: "preflight",
    label: "Environment checks",
    description: "Validate mounts, permissions, and runtime policy.",
    status:
      preflightTimeline.status === "pending"
        ? legacyImplicitStatus
        : preflightTimeline.status,
    ts: preflightTimeline.ts,
    error: preflightTimeline.error,
  };
  const modelsTimeline = latestTimeline(detail, "models");
  const models: PhaseInput = {
    id: "models",
    label: "Model runtime",
    description: "Resolve the configured model provider and model.",
    status:
      modelsTimeline.status === "pending"
        ? legacyImplicitStatus
        : modelsTimeline.status,
    ts: modelsTimeline.ts,
    error: modelsTimeline.error,
  };
  const secretsTimeline = latestTimeline(detail, "secrets");
  const secrets: PhaseInput = {
    id: "secrets",
    label: "Secret stores",
    description: "Prepare configured secret stores.",
    status:
      secretsTimeline.status === "pending"
        ? legacyImplicitStatus
        : secretsTimeline.status,
    ts: secretsTimeline.ts,
    error: secretsTimeline.error,
  };
  const gitTimeline = latestTimeline(detail, "git");
  const git = mergeSetupPhase(
    "git",
    "Git",
    "Configure git identity and remotes.",
    setup?.git,
    gitTimeline.status,
    gitTimeline.ts,
  );
  const githubTimeline = latestTimeline(detail, "github");
  const github = mergeSetupPhase(
    "github",
    "GitHub",
    "Authenticate GitHub access.",
    setup?.github,
    githubTimeline.status,
    githubTimeline.ts,
  );
  const contextTimeline = latestTimeline(detail, "context");
  const context: PhaseInput = {
    id: "context",
    label: "Project context",
    description: "Load project context files.",
    status:
      contextTimeline.status === "pending"
        ? legacyImplicitStatus
        : contextTimeline.status,
    ts: contextTimeline.ts,
    error: contextTimeline.error,
  };
  const skillsTimeline = latestTimeline(detail, "skills");
  const skills = mergeSetupPhase(
    "skills",
    "Skills",
    "Load available agent skills.",
    setup?.skills,
    skillsTimeline.status,
    skillsTimeline.ts,
  );
  const bootTimeline = latestTimeline(detail, "boot");
  const boot = mergeSetupPhase(
    "boot",
    "Boot script",
    "Run the sandbox boot script.",
    setup?.boot,
    bootTimeline.status,
    bootTimeline.ts,
  );

  const runtimeTimeline = latestTimeline(detail, "runtime");
  const runtime: PhaseInput = {
    id: "runtime",
    label: "Agent runtime",
    description: "Initialize the agent runtime and recover active work.",
    status:
      runtimeTimeline.status === "pending"
        ? legacyImplicitStatus
        : runtimeTimeline.status,
    ts: runtimeTimeline.ts,
    error: runtimeTimeline.error,
  };
  const readyTimeline = latestTimeline(detail, "ready");
  const priorPhases = [
    container,
    config,
    statePhase,
    daemonPhase,
    preflight,
    models,
    secrets,
    git,
    github,
    context,
    skills,
    boot,
    runtime,
  ];
  const failedBeforeReady =
    priorPhases.some((phase) => phase.status === "failed") ||
    daemon === "failed";
  const readyPrereqsComplete = priorPhases.every(phaseReadyTerminal);
  const ready: PhaseInput = {
    id: "ready",
    label: "Ready to chat",
    description: offline
      ? "Controller is unavailable because the container is offline."
      : "Controller session connected.",
    status:
      readyForCommands || readyTimeline.status === "done"
        ? "done"
        : failedBeforeReady || offline || stopping
          ? "pending"
          : readyPrereqsComplete
            ? "active"
            : "pending",
    ts: readyTimeline.ts,
  };

  const phases: BootPhase[] = [
    container,
    config,
    statePhase,
    daemonPhase,
    preflight,
    models,
    secrets,
    git,
    github,
    context,
    skills,
    boot,
    runtime,
    ready,
  ];

  // Once the sandbox is ready for commands it has finished booting; resolve
  // any phase we never received a terminal event for so the view reads as done
  // instead of leaving a lone spinner/empty step behind.
  if (readyForCommands)
    for (const phase of phases)
      if (phase.status === "pending" || phase.status === "active")
        phase.status = "done";

  const completed = phases.filter(
    (phase) =>
      phase.status === "done" ||
      phase.status === "skipped" ||
      phase.status === "degraded",
  ).length;
  const total = phases.length;
  const fraction = total === 0 ? 0 : completed / total;

  const anyFailed = phases.some((phase) => phase.status === "failed");
  let state: BootState;
  if (readyForCommands && !reconnecting) state = "ready";
  else if (anyFailed) state = "failed";
  else if (offline || stopping) state = "offline";
  else if (reconnecting) state = "reconnecting";
  else if (container.status !== "done") state = "provisioning";
  else state = "booting";

  const headline =
    state === "ready"
      ? "Ready to chat"
      : state === "failed"
        ? "Boot failed"
        : state === "offline"
          ? stopping
            ? "Stopping sandbox…"
            : "Sandbox offline"
          : state === "reconnecting"
            ? "Reconnecting…"
          : state === "provisioning"
            ? "Creating container…"
            : "Booting…";
  const showPhaseStepper =
    state === "provisioning" ||
    state === "booting" ||
    state === "reconnecting" ||
    state === "failed";

  return {
    phases,
    completed,
    total,
    fraction,
    headline,
    state,
    ready: readyForCommands,
    showPhaseStepper,
  };
}
