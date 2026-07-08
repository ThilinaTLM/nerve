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
} from "./sandbox-lifecycle";
import type { SandboxDetailState } from "./sandbox-ui-types";

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
  | "config"
  | "git"
  | "github"
  | "boot"
  | "skills"
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
export const isSandboxReadyForChat = sandboxIsConnected;
export const isSandboxTerminal = sandboxIsTerminal;

const STATUS_RANK: Record<BootPhaseStatus, number> = {
  pending: 0,
  active: 1,
  stopped: 2,
  degraded: 3,
  skipped: 4,
  failed: 5,
  done: 6,
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

/** Latest live timeline entry for a given phase name. */
function latestTimeline(
  detail: SandboxDetailState | undefined,
  phase: string,
): { status: BootPhaseStatus; ts?: string } {
  if (!detail) return { status: "pending" };
  let found: { status: BootPhaseStatus; ts?: string } = { status: "pending" };
  for (const item of detail.setupTimeline) {
    if (item.phase !== phase) continue;
    const mapped = fromTimelineStatus(item.status);
    if (STATUS_RANK[mapped] >= STATUS_RANK[found.status])
      found = {
        status: mapped,
        ts: item.completedAt ?? item.startedAt ?? item.ts,
      };
  }
  return found;
}

export function computeSandboxBootProgress(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): SandboxBootProgress {
  const observed = sandboxContainerState(record, detail);
  const daemon = sandboxDaemonStatus(detail);
  const connected = sandboxIsConnected(detail);
  const offline = sandboxIsOffline(record, detail);
  const stopping = sandboxIsStopping(record, detail);
  const failed = sandboxIsFailed(record, detail);
  const setup = detail?.status?.setup ?? detail?.snapshot?.setup;
  const setupFailed = Object.values(setup ?? {}).some(
    (phase) => phase?.status === "failed",
  );

  const containerRunningEnough =
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
          : observed === "creating" || observed === "starting"
            ? "active"
            : "pending",
    error: containerFailed ? errorText(record?.lastError) : undefined,
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
          : connected || setup || failed || daemon === "offline"
            ? "done"
            : "active",
    ts: configTimeline.ts,
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
  const bootTimeline = latestTimeline(detail, "boot");
  const boot = mergeSetupPhase(
    "boot",
    "Boot script",
    "Run the sandbox boot script.",
    setup?.boot,
    bootTimeline.status,
    bootTimeline.ts,
  );
  const skillsTimeline = latestTimeline(detail, "skills");
  const skills = mergeSetupPhase(
    "skills",
    "Skills",
    "Load available agent skills.",
    setup?.skills,
    skillsTimeline.status,
    skillsTimeline.ts,
  );

  const readyTimeline = latestTimeline(detail, "ready");
  const setupPhases = [git, github, boot, skills];
  const failedBeforeReady =
    container.status === "failed" ||
    config.status === "failed" ||
    setupPhases.some((phase) => phase.status === "failed") ||
    daemon === "failed";
  const ready: PhaseInput = {
    id: "ready",
    label: "Ready to chat",
    description: offline
      ? "Controller is unavailable because the container is offline."
      : "Controller session connected.",
    status:
      connected || readyTimeline.status === "done"
        ? "done"
        : failedBeforeReady || offline || stopping
          ? "pending"
          : container.status === "done"
            ? "active"
            : "pending",
    ts: readyTimeline.ts,
  };

  const phases: BootPhase[] = [
    container,
    config,
    git,
    github,
    boot,
    skills,
    ready,
  ];

  // Once the controller is connected the sandbox has finished booting; resolve
  // any phase we never received a terminal event for so the view reads as done
  // instead of leaving a lone spinner/empty step behind.
  if (connected)
    for (const phase of phases)
      if (phase.status === "pending" || phase.status === "active")
        phase.status = "done";

  const completed = phases.filter(
    (phase) => phase.status === "done" || phase.status === "skipped",
  ).length;
  const total = phases.length;
  const fraction = total === 0 ? 0 : completed / total;

  const anyFailed = phases.some((phase) => phase.status === "failed");
  let state: BootState;
  if (connected) state = "ready";
  else if (anyFailed) state = "failed";
  else if (offline || stopping) state = "offline";
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
          : state === "provisioning"
            ? "Creating container…"
            : "Booting…";
  const showPhaseStepper =
    state === "provisioning" || state === "booting" || state === "failed";

  return {
    phases,
    completed,
    total,
    fraction,
    headline,
    state,
    ready: connected,
    showPhaseStepper,
  };
}
