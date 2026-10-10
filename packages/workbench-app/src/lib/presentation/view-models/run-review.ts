/** Presentation-owned run review shapes. No runtime schemas. */
import type { ToolCallTranscriptRecord } from "./tool-records";
import type { ThinkingLevel, ModelSelection } from "@nervekit/contracts/models";

export type ApprovalRecord = {
  toolCallId: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  risk?:
    | "read"
    | "command"
    | "network"
    | "interaction"
    | "deployment"
    | "secret"
    | "destructive"
    | "agent_spawn"
    | "workspace_write";
  reason: string;
  status: "denied" | "pending" | "granted";
  requestedAt: string;
  offeredScopes: (
    | "single_call"
    | "always_conversation"
    | "always_project"
    | "always_user"
  )[];
  suggestedExceptions: {
    id: string;
    tool:
      | "read"
      | "bash"
      | "python_exec"
      | "edit"
      | "write"
      | "grep"
      | "find"
      | "ls"
      | "ask_user"
      | "todos_set"
      | "todos_get"
      | "web_search"
      | "web_fetch"
      | "explain_image"
      | "generate_image"
      | "kroki_export"
      | "jira_search_users"
      | "jira_search_issues"
      | "jira_get_issue"
      | "jira_get_project"
      | "jira_search_boards"
      | "jira_get_board"
      | "jira_get_sprint"
      | "jira_download_attachment"
      | "jira_create_issue"
      | "jira_update_issue"
      | "jira_transition_issue"
      | "jira_manage_comment"
      | "jira_manage_worklog"
      | "jira_manage_issue_link"
      | "jira_manage_attachment"
      | "jira_manage_sprint"
      | "jira_manage_backlog"
      | "confluence_search_spaces"
      | "confluence_search_pages"
      | "confluence_get_page"
      | "confluence_download_page"
      | "confluence_create_page"
      | "confluence_update_page"
      | "confluence_manage_comment"
      | "confluence_manage_page"
      | "confluence_manage_label"
      | "confluence_manage_restriction"
      | "confluence_manage_attachment"
      | "subagent_new"
      | "subagent_prompt"
      | "subagent_list"
      | "subagent_status"
      | "subagent_stop"
      | "task_start"
      | "task_status"
      | "task_logs"
      | "task_control"
      | "explore"
      | "plan_mode_enter"
      | "plan_mode_present"
      | "plan_mode_force_exit";
    effect: "allow" | "deny";
    rule: string;
  }[];
  suggestedRules: {
    id: string;
    enabled: boolean;
    priority: number;
    enforcement: "overridable" | "guardrail";
    when: {
      toolNames?: string[] | undefined;
      toolKinds?:
        | (
            | "filesystem"
            | "command"
            | "code"
            | "network"
            | "interaction"
            | "orchestration"
            | "deployment"
            | "integration"
            | "other"
          )[]
        | undefined;
      toolGroups?: string[] | undefined;
      baseRisks?:
        | (
            | "read"
            | "write"
            | "unknown"
            | "network"
            | "interaction"
            | "deployment"
            | "secret"
            | "destructive"
            | "agent_spawn"
          )[]
        | undefined;
      primaryArgument?:
        | {
            operator: "equals" | "not_equals";
            value: string | number | boolean | (string | number | boolean)[];
          }
        | { operator: "in"; value: (string | number | boolean)[] }
        | { operator: "glob"; value: string }
        | { operator: "exists"; value: boolean }
        | undefined;
      primaryTarget?:
        | {
            kind?: "path" | "url" | "agent" | "whole_tool" | undefined;
            access?: "read" | "write" | undefined;
            scope?: "exact" | "tree" | undefined;
            root?:
              | "project"
              | "nerve_home"
              | "nerve_data"
              | "plans"
              | undefined;
            pattern?: string | undefined;
          }
        | undefined;
      targets?:
        | {
            quantifier: "any" | "all";
            matcher: {
              kind?: "path" | "url" | "agent" | "whole_tool" | undefined;
              access?: "read" | "write" | undefined;
              scope?: "exact" | "tree" | undefined;
              root?:
                | "project"
                | "nerve_home"
                | "nerve_data"
                | "plans"
                | undefined;
              pattern?: string | undefined;
            };
          }
        | undefined;
      arguments?:
        | (
            | {
                path: string;
                operator: "equals" | "not_equals";
                value:
                  | string
                  | number
                  | boolean
                  | (string | number | boolean)[];
              }
            | {
                path: string;
                operator: "in";
                value: (string | number | boolean)[];
              }
            | { path: string; operator: "glob"; value: string }
            | { path: string; operator: "exists"; value: boolean }
          )[]
        | undefined;
    };
    decision: "allow" | "prompt" | "deny";
    description?: string | undefined;
  }[];
  resolvedAt?: string | undefined;
  resolutionNote?: string | undefined;
  permissionRuleSetId?: string | undefined;
};

export type UserQuestionRecord = {
  toolCallId: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  question: string;
  status: "pending" | "answered" | "dismissed";
  requestedAt: string;
  updatedAt: string;
  context?: string | undefined;
  recommendation?: string | undefined;
  answer?: string | undefined;
  resolvedAt?: string | undefined;
};

export type RunFailureCategory =
  | "unknown"
  | "provider"
  | "rate_limit"
  | "authentication"
  | "connection"
  | "harness";

export type RecoveryIssue = {
  id: string;
  conversationId: string;
  code:
    | "outcome_unknown"
    | "invalid_checkpoint"
    | "missing_artifact"
    | "conflicting_state"
    | "stale_branch";
  message: string;
  actions: ("inspect" | "cancel_run" | "authorize_retry")[];
  createdAt: string;
  runId?: string | undefined;
  workId?: string | undefined;
  proposalId?: string | undefined;
};

export interface ConversationCompactionFailedData {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
  failedAt: string;
  message: string;
  code?: "ineffective" | "stale" | "pending_work" | "no_new_history";
  failedEntryId?: string;
}

export type PlanReviewRecord = {
  id: string;
  toolCallId: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  slug: string;
  planPath: string;
  status:
    | "pending"
    | "accepted"
    | "accepted_in_new_chat"
    | "changes_requested"
    | "discarded"
    | "force_exited";
  requestedAt: string;
  updatedAt: string;
  title?: string | undefined;
  summary?: string | undefined;
  content?: string | undefined;
  feedback?: string | undefined;
  resolvedAt?: string | undefined;
};

export type ApprovalWithToolCall = ApprovalRecord & {
  toolCall: ToolCallTranscriptRecord;
};

export type PlanReviewResolveOptions = {
  feedback?: string;
  implementationModel?: ModelSelection;
  implementationThinkingLevel?: ThinkingLevel;
  compactBeforeImplementation?: boolean;
};

export type RunStatus =
  | "running"
  | "retrying"
  | "aborting"
  | "waiting"
  | "executing_tools"
  | "interrupted";

export interface ConversationRunRetrySnapshot {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  retryAt: string;
  errorMessage?: string;
  failureCategory?: RunFailureCategory;
  httpStatus?: number;
  failedEntryId?: string;
}

export interface ConversationRunRecoverySnapshot {
  errorMessage?: string;
  failureCategory?: RunFailureCategory;
  httpStatus?: number;
  continuable: boolean;
}

export type ConversationCompactionReason = "manual" | "threshold" | "overflow";
