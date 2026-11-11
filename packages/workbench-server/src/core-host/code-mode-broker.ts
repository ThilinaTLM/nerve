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
  /**
   * How the outer script was admitted and its classified risk: `user` when a
   * person approved it (a ceiling for nested approvals), `rule` when a policy
   * rule allowed it without approval.
   */
  admission: { by: "user" | "rule"; scriptRisk: CodeModeRisk };
};

/** One SDK call to check. */
export type CodeModeRequest = {
  toolName: string;
  args: Record<string, unknown>;
  /**
   * The call cannot be analysed (raw non-GET request), so `toolName` only
   * supplies the deny rules; its own allow rule never admits it. It runs only
   * in a script whose classified risk is destructive and that either a person
   * approved or a rule admitted while the nested verdict is `allow`.
   */
  approvalRequired?: boolean;
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
 * A person's approval of the script sets a ceiling: a call whose decision is
 * "approval" runs when its own risk is within it and is refused above it.
 * A script merely admitted by a rule has no ceiling, so such calls are refused,
 * except a raw request with an `allow` verdict in a destructive script (the
 * rule already admitted destructive work). Denials always hold.
 */
export function createCodeModeAuthorizer(prepareAdmission: PrepareAdmission) {
  return async (
    call: CodeModeCall,
    request: CodeModeRequest,
  ): Promise<void> => {
    const parsed = toolNameSchema.safeParse(request.toolName);
    if (!parsed.success || !brokerable(parsed.data))
      throw new ToolExecutionError(
        "NESTED_DENIED",
        `${request.toolName}: not available to code mode`,
      );
    const { signal, admission: scripted, ...identity } = call;
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
      if (verdict === "deny")
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${parsed.data}: denied${reason ? ` (${reason})` : ""}`,
        );
      const raw = request.approvalRequired === true;
      if (verdict === "allow" && !raw) return;
      const risk = raw
        ? "destructive"
        : codeModeToolRisk(parsed.data, request.args);
      const suffix = reason ? ` (${reason})` : "";
      if (scripted.by === "rule") {
        if (raw && verdict === "allow" && scripted.scriptRisk === "destructive")
          return;
        throw new ToolExecutionError(
          "NESTED_APPROVAL_REQUIRED",
          raw
            ? `${parsed.data}: a raw non-GET request needs the rule to allow it in a destructive script (script risk: ${describeCodeModeRisk(scripted.scriptRisk)}, rule verdict: ${verdict}); have a person approve the script or adjust the rule${suffix}`
            : `${parsed.data}: needs ${describeCodeModeRisk(risk)} approval, but the script was allowed by a rule rather than approved${suffix}`,
        );
      }
      const approvedRisk = scripted.scriptRisk;
      if (codeModeRiskWithin(risk, approvedRisk)) return;
      throw new ToolExecutionError(
        "NESTED_APPROVAL_REQUIRED",
        `${parsed.data}: script was approved for ${describeCodeModeRisk(approvedRisk)} operations; this call needs ${describeCodeModeRisk(risk)} approval${suffix}`,
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
