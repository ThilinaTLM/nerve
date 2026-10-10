/** Presentation-owned tool interactions shapes. No runtime schemas. */
import type { JsonValue } from "./records";

export type ToolCallInteraction =
  | {
      status: "cancelled" | "pending" | "resolved";
      requestedAt: string;
      updatedAt: string;
      kind: "approval";
      request: {
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
        offeredScopes: (
          | "single_call"
          | "same_tool_same_args"
          | "run"
          | "always"
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
                  value:
                    | string
                    | number
                    | boolean
                    | (string | number | boolean)[];
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
        normalizedArgs?: Record<string, JsonValue> | undefined;
        permissionRuleSetId?: string | undefined;
      };
      resolvedAt?: string | undefined;
      cancelledAt?: string | undefined;
      resolutionRequestId?: string | undefined;
      resolution?:
        | {
            action: "allow" | "deny";
            note?: string | undefined;
            scope?:
              | "single_call"
              | "same_tool_same_args"
              | "run"
              | "always"
              | "always_conversation"
              | "always_project"
              | "always_user"
              | undefined;
          }
        | undefined;
    }
  | {
      status: "cancelled" | "pending" | "resolved";
      requestedAt: string;
      updatedAt: string;
      kind: "user_input";
      request: {
        question: string;
        required: boolean;
        context?: string | undefined;
        recommendation?: string | undefined;
        placeholder?: string | undefined;
      };
      resolvedAt?: string | undefined;
      cancelledAt?: string | undefined;
      resolutionRequestId?: string | undefined;
      resolution?:
        | {
            action: "answer" | "dismiss";
            answer?: string | undefined;
            reason?: string | undefined;
          }
        | undefined;
    }
  | {
      status: "cancelled" | "pending" | "resolved";
      requestedAt: string;
      updatedAt: string;
      kind: "plan_review";
      request: {
        planPath: string;
        slug: string;
        allowNewConversation: boolean;
        title?: string | undefined;
        summary?: string | undefined;
      };
      resolvedAt?: string | undefined;
      cancelledAt?: string | undefined;
      resolutionRequestId?: string | undefined;
      resolution?:
        | {
            action:
              | "accept"
              | "accept_in_new_chat"
              | "request_changes"
              | "reject"
              | "discard";
            feedback?: string | undefined;
            implementationModel?: unknown;
            implementationThinkingLevel?: string | undefined;
            compactBeforeImplementation?: boolean | undefined;
          }
        | undefined;
    };

export type ToolPermissionEvaluation =
  | {
      decision: "allow" | "prompt" | "deny";
      reason: string;
      baseRisk:
        | "read"
        | "write"
        | "unknown"
        | "network"
        | "interaction"
        | "deployment"
        | "secret"
        | "destructive"
        | "agent_spawn";
      normalizedTargets: (
        | {
            kind: "path";
            access: "read" | "write";
            scope: "exact" | "tree";
            root: "project" | "nerve_home" | "nerve_data" | "plans";
            relativePath: string;
          }
        | {
            kind: "path";
            access: "read" | "write";
            scope: "exact" | "tree";
            absolutePath: string;
          }
        | { kind: "url"; normalizedUrl: string; access: "read" | "write" }
        | { kind: "agent"; agentId: string }
        | { kind: "whole_tool" }
      )[];
      winningRuleId: string;
      winningRule: {
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
                value:
                  | string
                  | number
                  | boolean
                  | (string | number | boolean)[];
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
      };
      winningRuleOrigin:
        | "project"
        | "user"
        | "baseline"
        | "rule_set"
        | "conversation";
      winningRuleSetId: string;
      winningRuleEnforcement: "overridable" | "guardrail";
      winningRulePrecedence: {
        enforcementRank: number;
        scopeRank: number;
        priority: number;
      };
      activeRuleSetIds: string[];
      selectedRuleSetId: string;
      ignoredOverlays: {
        origin: "project" | "user" | "conversation";
        path: string;
        reason: string;
      }[];
      policySnapshotHash: string;
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
                value:
                  | string
                  | number
                  | boolean
                  | (string | number | boolean)[];
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
    }
  | undefined;
