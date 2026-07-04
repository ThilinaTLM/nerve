import type {
  ManagedSandboxRecord,
  RemoveOptions,
  SandboxControllerSessionSummary,
  SandboxManagerStatus,
  SandboxSnapshotResult,
  SandboxStatusGetResult,
} from "@nervekit/shared";

/** Envelope shape returned by every sandbox-manager REST endpoint. */
export type ManagerEnvelope<T> = { ok: true; data: T };

export type SandboxLogChunk = {
  stream: string;
  chunk: string;
  ts?: string;
};

export type SandboxLogsResult = {
  chunks: SandboxLogChunk[];
  truncated: boolean;
};

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
  SandboxControllerSessionSummary,
  SandboxManagerStatus,
  SandboxSnapshotResult,
  SandboxStatusGetResult,
};
