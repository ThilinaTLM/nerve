import type { PermissionPort } from "@nervekit/conversation-core";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  quickScriptRiskWithin,
  quickScriptToolRisk,
  describeQuickScriptRisk,
  ToolExecutionError,
  type QuickScriptRisk,
} from "@nervekit/tools/execution";

type PrepareAdmission = NonNullable<PermissionPort["prepareAdmission"]>;
type AdmissionInput = Parameters<PrepareAdmission>[0];

/** Outer quick-script call identity a nested check is evaluated within. */
export type QuickScriptCall = Omit<
  AdmissionInput,
  "toolName" | "args" | "target"
> & {
  signal: AbortSignal;
  /**
   * How the outer script was admitted and its classified risk: `user` when a
   * person approved it (a ceiling for nested approvals), `rule` when a policy
   * rule allowed it without approval.
   */
  admission: { by: "user" | "rule"; scriptRisk: QuickScriptRisk };
};

/** One SDK call to check. */
export type QuickScriptRequest = {
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
 * Direct tools a quick-script SDK call may be authorized as: the Atlassian tools,
 * `read` for workspace files a script attaches, `kroki_export` for diagrams, and
 * `web_fetch` / `web_search` for the web namespace.
 */
function brokerable(toolName: string): boolean {
  return (
    toolName.startsWith("jira_") ||
    toolName.startsWith("confluence_") ||
    toolName === "read" ||
    toolName === "kroki_export" ||
    toolName === "web_fetch" ||
    toolName === "web_search"
  );
}

/**
 * Checks one SDK call from a quick-script script against the conversation's
 * current policy, exactly as a direct call to `toolName` would be checked.
 * A person's approval of the script sets a ceiling: a call whose decision is
 * "approval" runs when its own risk is within it and is refused above it.
 * A script merely admitted by a rule has no ceiling, so such calls are refused,
 * except a raw request with an `allow` verdict in a destructive script (the
 * rule already admitted destructive work). Denials always hold.
 */
export function createQuickScriptAuthorizer(
  prepareAdmission: PrepareAdmission,
) {
  return async (
    call: QuickScriptCall,
    request: QuickScriptRequest,
  ): Promise<void> => {
    const parsed = toolNameSchema.safeParse(request.toolName);
    if (!parsed.success || !brokerable(parsed.data))
      throw new ToolExecutionError(
        "NESTED_DENIED",
        `${request.toolName}: not available to quick_script`,
      );
    const { signal, admission: scripted, ...identity } = call;
    for (let attempt = 0; attempt <= MAX_STALE_RETRIES; attempt += 1) {
      signal.throwIfAborted();
      const admission = await prepareAdmission({
        ...identity,
        toolName: parsed.data,
        args: structuredClone(request.args),
        target: {
          kind: "quick_script_nested",
          parentToolName: "quick_script",
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
        : quickScriptToolRisk(parsed.data, request.args);
      const suffix = reason ? ` (${reason})` : "";
      if (scripted.by === "rule") {
        if (raw && verdict === "allow" && scripted.scriptRisk === "destructive")
          return;
        throw new ToolExecutionError(
          "NESTED_APPROVAL_REQUIRED",
          raw
            ? `${parsed.data}: a raw non-GET request needs the rule to allow it in a destructive script (script risk: ${describeQuickScriptRisk(scripted.scriptRisk)}, rule verdict: ${verdict}); have a person approve the script or adjust the rule${suffix}`
            : `${parsed.data}: needs ${describeQuickScriptRisk(risk)} approval, but the script was allowed by a rule rather than approved${suffix}`,
        );
      }
      const approvedRisk = scripted.scriptRisk;
      if (quickScriptRiskWithin(risk, approvedRisk)) return;
      throw new ToolExecutionError(
        "NESTED_APPROVAL_REQUIRED",
        `${parsed.data}: script was approved for ${describeQuickScriptRisk(approvedRisk)} operations; this call needs ${describeQuickScriptRisk(risk)} approval${suffix}`,
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
