import type { ToolName } from "@nervekit/contracts";
import type { MetaItem, PrimaryArg } from "../views/tool-presentation-types";
import type { ToolArgumentSource } from "./argument-source";

export type ToolLifecycleStage =
  | "drafting"
  | "approval"
  | "executing"
  | "completed";

export type ToolArgumentBody =
  | { kind: "none" }
  | {
      kind: "code";
      text: string;
      language: "bash" | "python" | "text";
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
  | { kind: "atlassian-summary"; text: string };

export type ToolArgumentPresentation = {
  primaryArg?: PrimaryArg;
  secondary: MetaItem[];
  body: ToolArgumentBody;
  safetyNotes: string[];
};

export type ToolDraftBodyPolicy = "none" | "meaningful";
export type ToolApprovalDetailPolicy = "target" | "summary" | "full";
export type ToolExecutionHandoff =
  | "retain-draft-until-output"
  | "replace-with-interaction"
  | "result-immediate";

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
  draftBody: ToolDraftBodyPolicy;
  approvalDetail: ToolApprovalDetailPolicy;
  executionHandoff: ToolExecutionHandoff;
  completedView: CompletedViewFamily;
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
