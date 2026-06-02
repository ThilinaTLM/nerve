/** Stable, backend-independent file error codes returned by {@link FileSystem} file operations. */
export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

/** Error returned by {@link FileSystem} file operations. */
export class FileError extends Error {
  /** Backend-independent error code. */
  public code: FileErrorCode;
  /** Absolute addressed path associated with the failure, when available. */
  public path?: string;

  constructor(
    code: FileErrorCode,
    message: string,
    path?: string,
    cause?: Error,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FileError";
    this.code = code;
    this.path = path;
  }
}

/** Stable, backend-independent execution error codes returned by {@link ExecutionEnv.exec}. */
export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown";

/** Error returned by {@link ExecutionEnv.exec}. */
export class ExecutionError extends Error {
  /** Backend-independent error code. */
  public code: ExecutionErrorCode;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExecutionError";
    this.code = code;
  }
}

/** Stable compaction error codes returned by compaction helpers. */
export type CompactionErrorCode =
  | "aborted"
  | "summarization_failed"
  | "invalid_session"
  | "unknown";

/** Error returned by compaction helpers. */
export class CompactionError extends Error {
  /** Backend-independent error code. */
  public code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CompactionError";
    this.code = code;
  }
}

/** Stable branch-summary error codes returned by branch summarization helpers. */
export type BranchSummaryErrorCode =
  | "aborted"
  | "summarization_failed"
  | "invalid_session";

/** Error returned by branch summarization helpers. */
export class BranchSummaryError extends Error {
  /** Backend-independent error code. */
  public code: BranchSummaryErrorCode;

  constructor(code: BranchSummaryErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BranchSummaryError";
    this.code = code;
  }
}

export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

/** Error thrown by session storage, repositories, and session tree operations. */
export class SessionError extends Error {
  /** Session subsystem error code. */
  public code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
  }
}

export type AgentHarnessErrorCode =
  | "busy"
  | "invalid_state"
  | "invalid_argument"
  | "session"
  | "hook"
  | "auth"
  | "compaction"
  | "branch_summary"
  | "unknown";

/** Public AgentHarness failure with a stable top-level classification. */
export class AgentHarnessError extends Error {
  public code: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentHarnessError";
    this.code = code;
  }
}
