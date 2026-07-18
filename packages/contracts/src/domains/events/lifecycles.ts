import type { ToolCallStatus } from "../tools/records.schema.js";

export type LifecycleTransitionTable<TState extends string> = Readonly<
  Record<TState, readonly TState[]>
>;

export class LifecycleTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly context: string;

  constructor(from: string, to: string, context: string) {
    super(`Illegal lifecycle transition ${from} -> ${to} (${context})`);
    this.name = "LifecycleTransitionError";
    this.from = from;
    this.to = to;
    this.context = context;
  }
}

export const toolCallTransitions = {
  requested: ["pending_approval", "running", "denied", "error"],
  pending_approval: ["running", "denied", "error"],
  waiting_for_user: ["running", "error"],
  running: ["waiting_for_user", "completed", "error"],
  completed: [],
  denied: [],
  error: [],
} as const satisfies LifecycleTransitionTable<ToolCallStatus>;

export type LiveMessageStatus = "started" | "completed" | "failed";
export const liveMessageTransitions = {
  started: ["completed", "failed"],
  completed: [],
  failed: [],
} as const satisfies LifecycleTransitionTable<LiveMessageStatus>;

export type TurnStatus = "started" | "completed" | "failed";
export const turnTransitions = {
  started: ["completed", "failed"],
  completed: [],
  failed: [],
} as const satisfies LifecycleTransitionTable<TurnStatus>;

export function canTransition<TState extends string>(
  table: LifecycleTransitionTable<TState>,
  from: TState,
  to: TState,
): boolean {
  return (table[from] as readonly TState[]).includes(to);
}

export function assertTransition<TState extends string>(
  table: LifecycleTransitionTable<TState>,
  from: TState,
  to: TState,
  context: string,
): void {
  if (!canTransition(table, from, to)) {
    throw new LifecycleTransitionError(from, to, context);
  }
}

export const TERMINAL_TOOL_STATUSES = ["completed", "denied", "error"] as const;

export function isTerminalToolStatus(
  status: ToolCallStatus,
): status is (typeof TERMINAL_TOOL_STATUSES)[number] {
  return (TERMINAL_TOOL_STATUSES as readonly ToolCallStatus[]).includes(status);
}

/**
 * Recovery rule: before a run becomes terminal, its producer must transition
 * every non-terminal tool call to `error` and use errorDetails.code
 * `interrupted`. Consumers may therefore treat terminal runs as having no live
 * tool-call lifecycles.
 */
export const INTERRUPTED_TOOL_ERROR_CODE = "interrupted";
