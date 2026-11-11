import type { PermissionPort } from "@nervekit/conversation-core";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  codeModeRiskWithin,
  codeModeToolRisk,
  describeCodeModeRisk,
  ToolExecutionError,
  type CodeModeRisk,
} from "@nervekit/tools/execution";

type PrepareAdmission = NonNullable<PermissionPort["prepareAdmission"]>;
type AdmissionInput = Parameters<PrepareAdmission>[0];

/** Outer code-mode call identity a nested check is evaluated within. */
export type CodeModeCall = Omit<
  AdmissionInput,
  "toolName" | "args" | "target"
> & {
  signal: AbortSignal;
  /** Risk the outer call was admitted with: the classification of its script. */
  approvedRisk: CodeModeRisk;
};

const MAX_STALE_RETRIES = 5;

/**
 * Direct tools a code-mode SDK call may be authorized as: the Atlassian tools,
 * `read` for workspace files a script attaches, and `kroki_export` for diagrams.
 */
function brokerable(toolName: string): boolean {
  return (
    toolName.startsWith("jira_") ||
    toolName.startsWith("confluence_") ||
    toolName === "read" ||
    toolName === "kroki_export"
  );
}

/**
 * Checks one SDK call from a code-mode script against the conversation's
 * current policy, exactly as a direct call to `toolName` would be checked.
 * The script itself was admitted (allowed or approved) as a whole with
 * `approvedRisk`, so a call whose policy decision is "approval" runs when its
 * own risk is within that ceiling and is refused above it. Denials always hold.
 */
export function createCodeModeAuthorizer(prepareAdmission: PrepareAdmission) {
  return async (
    call: CodeModeCall,
    request: { toolName: string; args: Record<string, unknown> },
  ): Promise<void> => {
    const parsed = toolNameSchema.safeParse(request.toolName);
    if (!parsed.success || !brokerable(parsed.data))
      throw new ToolExecutionError(
        "NESTED_DENIED",
        `${request.toolName}: not available to code mode`,
      );
    const { signal, approvedRisk, ...identity } = call;
    for (let attempt = 0; attempt <= MAX_STALE_RETRIES; attempt += 1) {
      signal.throwIfAborted();
      const admission = await prepareAdmission({
        ...identity,
        toolName: parsed.data,
        args: structuredClone(request.args),
        target: {
          kind: "code_mode_nested",
          parentToolName: "atlassian_code_mode",
          toolName: parsed.data,
          cwd: identity.cwd,
        },
      });
      const decision = admission.check();
      if (decision.kind === "stale") continue;
      if (decision.kind === "blocked")
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${parsed.data}: permission policy is unavailable until its configuration is repaired`,
        );
      const { decision: verdict, reason } = decision.supervision;
      if (verdict === "allow") return;
      if (verdict === "deny")
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${parsed.data}: denied${reason ? ` (${reason})` : ""}`,
        );
      const risk = codeModeToolRisk(parsed.data, request.args);
      if (codeModeRiskWithin(risk, approvedRisk)) return;
      throw new ToolExecutionError(
        "NESTED_APPROVAL_REQUIRED",
        `${parsed.data}: script was approved for ${describeCodeModeRisk(approvedRisk)} operations; this call needs ${describeCodeModeRisk(risk)} approval${reason ? ` (${reason})` : ""}`,
      );
    }
    throw new ToolExecutionError(
      "NESTED_DENIED",
      `${parsed.data}: permission policy kept changing; retry`,
      {},
      true,
    );
  };
}
