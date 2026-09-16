import type {
  RunFailureRecord,
  RunPromptRecord,
} from "@nervekit/contracts/runs";

/** Process-local controls only; canonical run state remains authoritative. */
export interface RunExecutionControl {
  steer(prompt: RunPromptRecord): Promise<void>;
  followUp(prompt: RunPromptRecord): Promise<void>;
  removeQueuedPrompt(promptId: string): Promise<boolean>;
  forcePush(): Promise<void>;
  continue(): Promise<void>;
  cancel(reason?: string): Promise<void>;
}

export type RunExecutionOutcome =
  | { status: "completed"; result?: Readonly<Record<string, unknown>> }
  | { status: "suspended" }
  | { status: "failed"; failure: RunFailureRecord }
  | { status: "interrupted"; message: string };
