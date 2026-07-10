import type {
  ApprovalPolicy,
  PermissionLevel,
  ToolGroupName,
  ToolName,
  ToolRisk,
} from "@nervekit/contracts";
import type {
  ToolExecutionContext,
  ToolExecutionOutputUpdate,
  ToolExecutionResult,
} from "../types.js";

export type ToolDecisionKind = "allow" | "approval" | "deny";

export type ToolDecision = {
  decision: ToolDecisionKind;
  risk: ToolRisk;
  reason: string;
  normalizedArgs: Record<string, unknown>;
};

export type ToolHandlerContext = ToolExecutionContext & {
  toolName: ToolName;
  identity?: unknown;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolHandlerContext,
) => Promise<ToolExecutionResult>;

export type ToolHandlerRegistry = Partial<Record<ToolName, ToolHandler>>;

export type ToolAvailabilityInput = {
  permissionLevel?: PermissionLevel;
  enabledNames?: readonly ToolName[];
  disabledNames?: readonly ToolName[];
  enabledGroups?: readonly ToolGroupName[];
  disabledGroups?: readonly ToolGroupName[];
  unavailableNames?: readonly ToolName[];
  capabilities?: Partial<Record<string, boolean>>;
  capabilityForTool?: Partial<Record<ToolName, string>>;
  includeHostTools?: boolean;
};

export type ToolLifecycleHooks = {
  requested?: (
    name: ToolName,
    args: Record<string, unknown>,
  ) => void | Promise<void>;
  started?: (
    name: ToolName,
    args: Record<string, unknown>,
  ) => void | Promise<void>;
  completed?: (
    name: ToolName,
    result: ToolExecutionResult,
  ) => void | Promise<void>;
  failed?: (name: ToolName, error: unknown) => void | Promise<void>;
  output?: (name: ToolName, update: ToolExecutionOutputUpdate) => void;
};

export type SharedPermissionInput = {
  permissionLevel: PermissionLevel;
  approvalPolicy: ApprovalPolicy;
  groupRequireApproval?: "never" | "risky" | "always";
  allowReadOnlyNetwork?: boolean;
};

export class ToolRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolRuntimeError";
  }
}

export class ToolUnavailableError extends ToolRuntimeError {
  constructor(toolName: string) {
    super(
      "TOOL_UNAVAILABLE",
      `Tool '${toolName}' is not available in this host.`,
      {
        toolName,
      },
    );
  }
}

export class ToolValidationError extends ToolRuntimeError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_TOOL_ARGUMENTS", message, details);
  }
}
