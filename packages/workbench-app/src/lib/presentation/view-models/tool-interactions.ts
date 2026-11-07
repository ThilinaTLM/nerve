/** Presentation-owned tool interactions shapes. No runtime schemas. */
import type {
  ConfigurationBlockedRequest,
  UserInputQuestion,
} from "@nervekit/contracts/core";
import type {
  PermissionEvaluationResult,
  PermissionException,
  PermissionRule,
  ToolRisk,
} from "@nervekit/contracts/permissions";
import type { JsonValue } from "./records";

export type ApprovalScope =
  | "single_call"
  | "same_tool_same_args"
  | "run"
  | "always"
  | "always_conversation"
  | "always_project"
  | "always_user";

export type ToolCallInteraction =
  | {
      kind: "configuration_blocked";
      status: "pending" | "resolved" | "cancelled";
      requestedAt: string;
      updatedAt: string;
      request: ConfigurationBlockedRequest;
    }
  | {
      status: "cancelled" | "pending" | "resolved";
      requestedAt: string;
      updatedAt: string;
      kind: "approval";
      request: {
        risk?: ToolRisk;
        reason: string;
        offeredScopes: ApprovalScope[];
        suggestedExceptions: PermissionException[];
        suggestedRules: PermissionRule[];
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
            scope?: ApprovalScope | undefined;
          }
        | undefined;
    }
  | {
      status: "cancelled" | "pending" | "resolved";
      requestedAt: string;
      updatedAt: string;
      kind: "user_input";
      request: {
        questions: UserInputQuestion[];
        required: boolean;
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

export type ToolPermissionEvaluation = PermissionEvaluationResult | undefined;
