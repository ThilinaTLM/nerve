import type { TaskOutcome } from "@nervekit/contracts/core";

export type { TaskOutcome };

export type TaskKind = "bash" | "subagent";

export interface TaskRef {
  kind: TaskKind;
  /** bashId or child conversationId. */
  id: string;
  parentConversationId: string;
}

export interface TaskTerminal {
  outcome: TaskOutcome;
  /** Already projected for the model. */
  text: string;
  assetIds: string[];
  detail:
    | { kind: "bash"; exitCode: number | null }
    | { kind: "subagent"; assignmentId: string };
  /** Stable dedupe id for the parent notice; generated when absent. */
  noticeInputId?: string;
}

export interface TaskHandle {
  /** Rejects when the work can no longer be observed; the service then settles it as interrupted. */
  wait(): Promise<TaskTerminal>;
  cancel(): Promise<void>;
}

export interface TaskRunner {
  readonly kind: TaskKind;
  /** Persisted tasks that are still running (none for kinds whose state is derived). */
  running(parentConversationId?: string): TaskRef[];
  isRunning(ref: TaskRef): boolean;
  /** Re-attach to live work; undefined when it cannot be verified. */
  recover(ref: TaskRef): Promise<TaskHandle | undefined>;
  /** Terminal for an outcome the runner did not observe itself (cancelled, interrupted). */
  describe(ref: TaskRef, outcome: TaskOutcome): Promise<TaskTerminal>;
  /**
   * Persist the terminal state inside the settle transaction.
   * Return false when the task is already terminal; nothing is then announced.
   */
  persist?(ref: TaskRef, terminal: TaskTerminal): boolean;
  /** Keep the terminal state but skip the parent notice. */
  suppressNotice?(ref: TaskRef, terminal: TaskTerminal): boolean;
  /** After a settle attempt committed. */
  changed?(ref: TaskRef): void;
}
