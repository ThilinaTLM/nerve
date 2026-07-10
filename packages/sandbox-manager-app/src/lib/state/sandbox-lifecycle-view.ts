import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { sandboxSetupTimeline } from "./sandbox-boot-progress";
import {
  sandboxContainerState,
  sandboxDaemonStatus,
  sandboxIsConnected,
  sandboxLifecycleState,
} from "./sandbox-lifecycle";
import type { SandboxStatusTone } from "./sandbox-status";
import type { SandboxDetailState } from "./sandbox-ui-types";

export type SandboxLifecycleViewState =
  | "creating"
  | "connecting"
  | "starting"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "failed"
  | "removed";

export type SandboxPrimaryAction =
  | "new_conversation"
  | "start"
  | "restart"
  | "open_logs"
  | "none";

export type SandboxLifecycleIssue = {
  stage?: string;
  code?: string;
  message: string;
};

export type SandboxLifecycleView = {
  state: SandboxLifecycleViewState;
  label: string;
  tone: SandboxStatusTone;
  headline: string;
  description: string;
  since?: string;
  activeStage?: string;
  reconnectAttempts?: number;
  issue?: SandboxLifecycleIssue;
  canChat: boolean;
  readOnly: boolean;
  defaultDetailsOpen: boolean;
  primaryAction: SandboxPrimaryAction;
};

const LABELS: Record<SandboxLifecycleViewState, string> = {
  creating: "Creating",
  connecting: "Connecting",
  starting: "Starting",
  ready: "Ready",
  degraded: "Degraded",
  reconnecting: "Reconnecting",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
  removed: "Removed",
};

const TONES: Record<SandboxLifecycleViewState, SandboxStatusTone> = {
  creating: "running",
  connecting: "running",
  starting: "running",
  ready: "good",
  degraded: "warn",
  reconnecting: "running",
  stopping: "warn",
  stopped: "neutral",
  failed: "danger",
  removed: "neutral",
};

export function sandboxLifecycleView(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): SandboxLifecycleView {
  const lifecycle = sandboxLifecycleState(record, detail);
  const container = sandboxContainerState(record, detail);
  const daemon = sandboxDaemonStatus(detail);
  const connected = sandboxIsConnected(detail);
  const timeline = sandboxSetupTimeline(detail);
  const activeItem = [...timeline]
    .reverse()
    .find((item) => item.status === "started");
  const failedItem = [...timeline]
    .reverse()
    .find((item) => item.status === "failed" || item.status === "timeout");
  const hasPriorReady = Boolean(
    record?.daemon?.readyAt ||
      detail?.latestSession?.readyAt ||
      detail?.status?.lastSession?.readyAt ||
      detail?.snapshot?.lastSession?.readyAt,
  );

  let state: SandboxLifecycleViewState;
  if (
    lifecycle === "removed" ||
    container === "removed" ||
    record?.desiredState === "removed"
  )
    state = "removed";
  else if (
    lifecycle === "failed" ||
    daemon === "failed" ||
    container === "failed" ||
    record?.observedState === "failed"
  )
    state = "failed";
  else if (
    lifecycle === "stopping" ||
    daemon === "stopping" ||
    container === "stopping"
  )
    state = "stopping";
  else if (
    lifecycle === "stopped" ||
    (lifecycle === "record_created" && record?.desiredState === "created") ||
    daemon === "offline" ||
    container === "exited" ||
    record?.desiredState === "stopped"
  )
    state = "stopped";
  else if (
    lifecycle === "reconnecting" ||
    daemon === "reconnecting" ||
    container === "reconnecting" ||
    (!connected && hasPriorReady && record?.desiredState === "running")
  )
    state = "reconnecting";
  else if (lifecycle === "degraded" || daemon === "degraded")
    state = "degraded";
  else if (lifecycle === "ready" || daemon === "ready") state = "ready";
  else if (
    lifecycle === "record_created" ||
    lifecycle === "container_creating" ||
    lifecycle === "container_created" ||
    lifecycle === "container_starting" ||
    container === "creating" ||
    container === "starting"
  )
    state = "creating";
  else if (!connected && lifecycle === "container_started")
    state = "connecting";
  else state = "starting";

  const issue = issueFrom(
    failedItem?.error,
    failedItem?.phase,
    record?.lastError,
  );
  const reconnectAttempts = detail?.status?.connectivity?.reconnectAttempts;
  const activeStage = activeItem?.phase;
  const description = descriptionFor(
    state,
    activeStage,
    reconnectAttempts,
    issue,
  );
  const canChat =
    state === "ready" || state === "degraded" || state === "starting";
  const readOnly = ["stopping", "stopped", "failed", "removed"].includes(state);
  const primaryAction: SandboxPrimaryAction =
    state === "ready" || state === "degraded"
      ? "new_conversation"
      : state === "stopped"
        ? "start"
        : state === "failed"
          ? "open_logs"
          : "none";

  return {
    state,
    label: LABELS[state],
    tone: TONES[state],
    headline: headlineFor(
      state,
      state === "failed" ? issue?.stage : activeStage,
    ),
    description,
    since:
      activeItem?.startedAt ??
      detail?.status?.connectivity?.disconnectedAt ??
      record?.lifecycleUpdatedAt ??
      record?.updatedAt,
    activeStage,
    reconnectAttempts,
    issue,
    canChat,
    readOnly,
    defaultDetailsOpen: [
      "creating",
      "connecting",
      "starting",
      "reconnecting",
      "degraded",
      "failed",
    ].includes(state),
    primaryAction,
  };
}

function headlineFor(
  state: SandboxLifecycleViewState,
  activeStage?: string,
): string {
  switch (state) {
    case "creating":
      return "Creating the sandbox container";
    case "connecting":
      return "Waiting for the agent to connect";
    case "starting":
      return activeStage
        ? `Starting: ${stageLabel(activeStage)}`
        : "Preparing the sandbox agent";
    case "ready":
      return "Ready for a new conversation";
    case "degraded":
      return "Ready with limitations";
    case "reconnecting":
      return "Restoring the controller connection";
    case "stopping":
      return "Stopping the sandbox";
    case "stopped":
      return "Sandbox is stopped";
    case "failed":
      return activeStage
        ? `${stageLabel(activeStage)} failed`
        : "Sandbox startup failed";
    case "removed":
      return "Sandbox has been removed";
  }
}

function descriptionFor(
  state: SandboxLifecycleViewState,
  activeStage?: string,
  reconnectAttempts?: number,
  issue?: SandboxLifecycleIssue,
): string {
  switch (state) {
    case "creating":
      return "Provisioning the container and mounted workspace.";
    case "connecting":
      return "The container is running. The sandbox agent is starting and connecting to the manager.";
    case "starting":
      return activeStage
        ? `${stageLabel(activeStage)} is in progress. You can leave this tab open while setup continues.`
        : "The controller is connected and startup checks are in progress.";
    case "ready":
      return "The agent is connected and all required startup checks completed.";
    case "degraded":
      return (
        issue?.message ??
        "The agent is usable, but one or more optional capabilities are limited."
      );
    case "reconnecting":
      return `${reconnectAttempts ? `Retry ${reconnectAttempts}. ` : ""}The container is still running; queued work is retained while the connection recovers.`;
    case "stopping":
      return "New commands are disabled while the container shuts down.";
    case "stopped":
      return "Previous conversations remain available as read-only snapshots. Start the sandbox to continue.";
    case "failed":
      return (
        issue?.message ??
        "Open the logs to identify the failed startup step, then restart the sandbox."
      );
    case "removed":
      return "Only previously stored conversation snapshots remain available.";
  }
}

function stageLabel(stage: string): string {
  return (
    {
      config: "Validating configuration",
      state: "Preparing state",
      controller: "Connecting to the manager",
      preflight: "Checking the environment",
      models: "Resolving the model",
      secrets: "Preparing secrets",
      git: "Configuring Git",
      github: "Authenticating GitHub",
      context: "Loading project context",
      skills: "Loading skills",
      boot: "Running boot commands",
      runtime: "Initializing the agent runtime",
      ready: "Announcing readiness",
    }[stage] ?? stage
  );
}

function issueFrom(
  timelineError: string | undefined,
  stage: string | undefined,
  recordError: ManagedSandboxRecord["lastError"] | undefined,
): SandboxLifecycleIssue | undefined {
  const text = timelineError ?? recordError?.message;
  if (!text) return undefined;
  const match = /^([A-Z][A-Z0-9_]+):\s*(.+)$/s.exec(text);
  return {
    stage,
    code: match?.[1] ?? recordError?.code,
    message: match?.[2] ?? text,
  };
}
