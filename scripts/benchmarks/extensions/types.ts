import type { Atlassian, Sandbox } from "./atlassian.ts";

export type Variant = "quick_script" | "direct";
export const VARIANTS: readonly Variant[] = ["quick_script", "direct"];

export type TaskCategory = "lookup" | "join" | "bulk" | "document" | "pitfall";

/** What an auto-answered approval may touch; everything else is denied. */
export interface ApprovalScope {
  /** Issue keys the task may modify; `undefined` allows any key inside the sandbox project. */
  issueKeys?: readonly string[];
  /** Confluence page ids the task may modify; `undefined` allows any page in the sandbox space. */
  pageIds?: readonly string[];
  /** Task creates new issues or pages, so unknown keys and ids are expected. */
  allowCreate?: boolean;
  /** Deleting issues or pages. */
  allowDelete?: boolean;
  /** Workspace file tools and shell (bash, python_exec, write, edit). */
  allowShell?: boolean;
}

/** Per-run state handed to setup, scope and check. */
export interface TaskContext {
  readonly atlassian: Atlassian;
  readonly sandbox: Sandbox;
  /** Short unique id of this run; embedded in every fixture name. */
  readonly runId: string;
  /** Label put on every Jira fixture (`bench-<runId>`). */
  readonly tag: string;
  /** Per-run working directory inside the benchmark project. */
  readonly workspaceDir: string;
  /** Fixture values recorded by setup (keys, ids, expected values). */
  readonly data: Record<string, unknown>;
  /** Register an undo that runs after the run, in reverse order, even on failure. */
  onCleanup(label: string, undo: () => Promise<void>): void;
}

export interface RunOutcome {
  /** Text of the final assistant message. */
  readonly answer: string;
  readonly toolCalls: readonly { name: string; ok: boolean; text: string }[];
}

export interface CheckResult {
  readonly pass: boolean;
  /** One line per failed expectation (empty on success). */
  readonly failures: readonly string[];
}

export interface TaskDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: TaskCategory;
  /** Creates Jira or Confluence content (needs the sandbox and cleanup). */
  readonly writes: boolean;
  /** Typical number of model requests per run, for the cost estimate. */
  readonly estimatedModelCalls: number;
  /** Create fixtures and return the user prompt. Throws `TaskSkipped` when the site cannot exercise the task. */
  setup(ctx: TaskContext): Promise<string>;
  scope(ctx: TaskContext): ApprovalScope;
  /** Read-only verification against Jira/Confluence and/or the final answer. */
  check(ctx: TaskContext, outcome: RunOutcome): Promise<CheckResult>;
}

export class TaskSkipped extends Error {}
