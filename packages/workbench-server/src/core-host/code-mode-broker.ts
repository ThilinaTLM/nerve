import type { PermissionPort } from "@nervekit/conversation-core";
import { toolNameSchema } from "@nervekit/contracts/tools";
import { ToolExecutionError } from "@nervekit/tools/execution";

type PrepareAdmission = NonNullable<PermissionPort["prepareAdmission"]>;
type AdmissionInput = Parameters<PrepareAdmission>[0];

/** Outer code-mode call identity a nested check is evaluated within. */
export type CodeModeCall = Omit<
  AdmissionInput,
  "toolName" | "args" | "target"
> & { signal: AbortSignal };

const MAX_STALE_RETRIES = 5;

/**
 * Checks one SDK call from a code-mode script against the conversation's
 * current policy, exactly as a direct call to `toolName` would be checked.
 * Approval prompts inside a running script are not supported yet: a call that
 * needs approval is refused with its reason.
 */
export function createCodeModeAuthorizer(prepareAdmission: PrepareAdmission) {
  return async (
    call: CodeModeCall,
    request: { toolName: string; args: Record<string, unknown> },
  ): Promise<void> => {
    const parsed = toolNameSchema.safeParse(request.toolName);
    if (
      !parsed.success ||
      !(
        parsed.data.startsWith("jira_") || parsed.data.startsWith("confluence_")
      )
    )
      throw new ToolExecutionError(
        "NESTED_DENIED",
        `${request.toolName}: not available to code mode`,
      );
    const { signal, ...identity } = call;
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
      throw new ToolExecutionError(
        "NESTED_APPROVAL_REQUIRED",
        `${parsed.data}: needs approval${reason ? ` (${reason})` : ""}, which code mode cannot request yet`,
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
