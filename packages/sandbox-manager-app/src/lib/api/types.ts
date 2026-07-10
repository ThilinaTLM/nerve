import type {
  ManagedSandboxRecord,
  RemoveOptions,
  SandboxConfigYamlResult,
  SandboxContainerLogsResult,
  SandboxControllerSessionSummary,
  SandboxManagerStatus,
  SandboxSnapshotResult,
  SandboxStatusGetResult,
} from "@nervekit/contracts";

/** Envelope shape returned by every sandbox-manager REST endpoint. */
export type ManagerEnvelope<T> = { ok: true; data: T };

export type SandboxLogsResult = SandboxContainerLogsResult;

export type SandboxLogsQuery = {
  tail?: number;
  since?: string;
  maxBytes?: number;
};

export type SandboxSnapshotQuery = {
  conversationId?: string;
  agentId?: string;
  runId?: string;
};

export type {
  ManagedSandboxRecord,
  RemoveOptions,
  SandboxConfigYamlResult,
  SandboxControllerSessionSummary,
  SandboxManagerStatus,
  SandboxSnapshotResult,
  SandboxStatusGetResult,
};
