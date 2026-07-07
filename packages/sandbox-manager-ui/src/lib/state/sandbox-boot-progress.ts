import type {
  ManagedSandboxRecord,
  StartupSetupStatus,
} from "@nervekit/shared";
import type { SandboxDetailState } from "./sandbox-ui-types";

export type BootPhaseStatus =
  | "pending"
  | "active"
  | "done"
  | "skipped"
  | "failed"
  | "degraded";

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

export type BootState = "provisioning" | "booting" | "ready" | "failed";

export type SandboxBootProgress = {
  phases: BootPhase[];
  completed: number;
  total: number;
  fraction: number;
  headline: string;
  state: BootState;
  ready: boolean;
};

/**
 * Controller connectivity, combining the last fetched status snapshot with the
 * live signal maintained from the sandbox event stream. The status snapshot is
 * only refreshed on load, so the live flag is what keeps the workspace in sync
 * as the sandbox finishes booting.
 */
export function isSandboxConnected(
  detail: SandboxDetailState | undefined,
): boolean {
  return (
    detail?.status?.connected === true || detail?.controllerConnected === true
  );
}

/** Chat is available once the controller session reports connected. */
export function isSandboxReadyForChat(
  detail: SandboxDetailState | undefined,
): boolean {
  return isSandboxConnected(detail);
}

/** States where chat/queue should be blocked entirely. */
export function isSandboxTerminal(
  record: ManagedSandboxRecord | undefined,
): boolean {
  return (
    record?.observedState === "removed" || record?.observedState === "exited"
  );
}

const STATUS_RANK: Record<BootPhaseStatus, number> = {
  pending: 0,
  active: 1,
  degraded: 2,
  skipped: 3,
  failed: 4,
  done: 5,
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
      found = { status: mapped, ts: item.ts };
  }
  return found;
}

export function computeSandboxBootProgress(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): SandboxBootProgress {
  const observed = record?.observedState;
  const connected = isSandboxConnected(detail);
  const daemonFailed = detail?.status?.status === "failed";
  const setup = detail?.status?.setup;
  const setupFailed = Object.values(setup ?? {}).some(
    (phase) => phase?.status === "failed",
  );

  const containerDone =
    observed === "running" ||
    observed === "reconnecting" ||
    observed === "exited" ||
    observed === "failed" ||
    connected ||
    detail?.status !== undefined;
  const containerFailed =
    (observed === "failed" || daemonFailed) && !setupFailed;

  const container: PhaseInput = {
    id: "container",
    label: "Container",
    description: "Provision and start the sandbox container.",
    status: containerFailed
      ? "failed"
      : containerDone
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
          : connected || setup || daemonFailed
            ? "done"
            : "active",
    ts: configTimeline.ts,
  };

  const git = mergeSetupPhase(
    "git",
    "Git",
    "Configure git identity and remotes.",
    setup?.git,
    latestTimeline(detail, "git").status,
    latestTimeline(detail, "git").ts,
  );
  const github = mergeSetupPhase(
    "github",
    "GitHub",
    "Authenticate GitHub access.",
    setup?.github,
    latestTimeline(detail, "github").status,
    latestTimeline(detail, "github").ts,
  );
  const boot = mergeSetupPhase(
    "boot",
    "Boot script",
    "Run the sandbox boot script.",
    setup?.boot,
    latestTimeline(detail, "boot").status,
    latestTimeline(detail, "boot").ts,
  );
  const skills = mergeSetupPhase(
    "skills",
    "Skills",
    "Load available agent skills.",
    setup?.skills,
    latestTimeline(detail, "skills").status,
    latestTimeline(detail, "skills").ts,
  );

  const readyTimeline = latestTimeline(detail, "ready");
  const setupPhases = [git, github, boot, skills];
  const failedBeforeReady =
    container.status === "failed" ||
    config.status === "failed" ||
    setupPhases.some((phase) => phase.status === "failed") ||
    daemonFailed;
  const ready: PhaseInput = {
    id: "ready",
    label: "Ready to chat",
    description: "Controller session connected.",
    status:
      connected || readyTimeline.status === "done"
        ? "done"
        : failedBeforeReady
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
  else if (container.status !== "done") state = "provisioning";
  else state = "booting";

  const headline =
    state === "ready"
      ? "Ready to chat"
      : state === "failed"
        ? "Boot failed"
        : state === "provisioning"
          ? "Creating container…"
          : "Booting…";

  return {
    phases,
    completed,
    total,
    fraction,
    headline,
    state,
    ready: connected,
  };
}
