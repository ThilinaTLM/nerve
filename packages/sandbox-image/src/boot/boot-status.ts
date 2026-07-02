export type BootPhaseStatus = {
  name: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "timeout"
    | "skipped";
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
};
