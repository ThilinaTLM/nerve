export type MonitorCause =
  | "filesystem"
  | "poll"
  | "poll_error"
  | "manual"
  | "overflow";

export interface ChangeNotice {
  scopeId: string;
  generation: number;
  causes: MonitorCause[];
  paths: string[];
  fullRefreshRequired: boolean;
}

export interface DirectoryMonitorScope {
  id: string;
  paths: string[];
  pollIntervalMs?: number;
}

/**
 * A project tree watched recursively while skipping directories excluded by
 * `.gitignore`/`.ignore`/git excludes (and `.git`). Notices carry absolute paths of
 * changed, non-ignored entries; `fullRefreshRequired` means paths were dropped.
 */
export interface TreeMonitorScope {
  id: string;
  root: string;
  pollIntervalMs?: number;
}

export interface GitMonitorScope {
  id: string;
  repository: string;
  pollIntervalMs?: number;
}

export interface MonitorScopeState {
  generation: number;
  watchedPaths: number;
  degraded: boolean;
}

export interface MonitorDiagnostics {
  activeScopes: number;
  registrations: number;
  degradedScopes: number;
  emittedNotices: number;
  coalescedTriggers: number;
  overflows: number;
  pollCount: number;
  pollFailures: number;
}

export interface ChangeMonitorOptions {
  maxScopes?: number;
  maxRegistrations?: number;
  maxDirectoriesPerScope?: number;
  /** Directory watch budget for tree scopes (default 20_000). */
  maxTreeDirectories?: number;
  maxGitPaths?: number;
  maxPathsPerNotice?: number;
}
