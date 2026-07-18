import type { ToolName } from "@nervekit/contracts";
import type { MetaItem, PrimaryArg } from "../views/tool-presentation-types";
import type { ToolArgumentSource } from "./argument-source";

export type ToolLifecycleStage =
  | "drafting"
  | "approval"
  | "executing"
  | "failed"
  | "completed";

export type ToolArgumentBody =
  | { kind: "none" }
  | {
      kind: "code";
      text: string;
      language: "bash" | "python" | "text" | "json";
      label?: string;
      tail?: boolean;
    }
  | { kind: "diff"; text: string; label?: string; tail?: boolean }
  | {
      kind: "key-values";
      items: Array<{
        label: string;
        value: string;
        mono?: boolean;
        tone?: MetaItem["tone"];
      }>;
    }
  | {
      kind: "checklist";
      items: Array<{ text: string; done: boolean }>;
    }
  | { kind: "text-summary"; text: string; label?: string }
  | { kind: "atlassian-summary"; text: string }
  | {
      kind: "atlassian-draft";
      /** Ordered field rows; `value === undefined` means expected/pending. */
      fields: Array<{
        label: string;
        value?: string;
        mono?: boolean;
        tone?: MetaItem["tone"];
      }>;
      /** Long-form section; `text === undefined` means not yet streamed. */
      text?: { label: string; text?: string; language?: "xml" };
    };

export type ToolArgumentPresentation = {
  primaryArg?: PrimaryArg;
  secondary: MetaItem[];
  body: ToolArgumentBody;
  safetyNotes: string[];
};

/**
 * How the card's persistent argument section behaves across the lifecycle:
 * - `persistent`: argument body stays mounted in every state, including
 *   completed (the completed view must not render it again).
 * - `until-result`: argument body stays mounted through drafting, approval,
 *   and execution, and is replaced once the result section shows output.
 * - `none`: no argument section; approval-stage bodies render inside the
 *   approval prompt instead.
 */
export type ToolArgumentRegion = "persistent" | "until-result" | "none";

/** Executing-state placeholder rendered in the result section. */
export type ToolResultPlaceholder = {
  variant: "text" | "list";
  rows: number;
};

export type CompletedViewFamily =
  | "read"
  | "bash"
  | "python"
  | "edit"
  | "write"
  | "grep"
  | "find"
  | "ls"
  | "ask_user"
  | "todos"
  | "task_action"
  | "task_status"
  | "task_logs"
  | "explore"
  | "plan_mode"
  | "jira"
  | "confluence"
  | "web_search"
  | "web_fetch";

export type ToolLifecycleSpec<Name extends ToolName = ToolName> = {
  name: Name;
  argumentRegion: ToolArgumentRegion;
  completedView: CompletedViewFamily;
  /** Placeholder shown while executing without durable output. */
  resultPlaceholder?: ToolResultPlaceholder;
  emptyResult?: string;
  present: (
    source: ToolArgumentSource,
    stage: ToolLifecycleStage,
    cwd?: string,
  ) => ToolArgumentPresentation;
};

export type UnknownToolLifecycleSpec = Omit<
  ToolLifecycleSpec,
  "name" | "completedView"
> & {
  name: "unknown";
  completedView: "generic";
};

export const noArgumentBody = (): ToolArgumentBody => ({ kind: "none" });

export function argumentPresentation(
  input: Partial<Omit<ToolArgumentPresentation, "body">> & {
    body?: ToolArgumentBody;
  } = {},
): ToolArgumentPresentation {
  return {
    primaryArg: input.primaryArg,
    secondary: input.secondary ?? [],
    body: input.body ?? noArgumentBody(),
    safetyNotes: input.safetyNotes ?? [],
  };
}
