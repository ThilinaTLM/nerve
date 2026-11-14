import type { PermissionPort } from "@nervekit/conversation-core";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  quickScriptRiskWithin,
  quickScriptToolRisk,
  quickScriptRiskOfMethod,
  findQuickScriptNamespace,
  type QuickScriptRegistry,
  describeQuickScriptRisk,
  type QuickScriptRisk,
} from "@nervekit/tools/quick-script";
import { hostRegistry } from "./host-tools.js";
import {
  ToolExecutionError,
  type QuickScriptNestedRequest,
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

/** One SDK call to check: an operation with its targets and risk, or a remaining direct tool (`web_fetch`, `read` / `write` / `edit`). */
export type QuickScriptRequest = QuickScriptNestedRequest;

const MAX_STALE_RETRIES = 5;

/** Direct tools a quick-script SDK call may still be authorized as: `read` / `write` / `edit` for workspace files and `web_fetch` for `web.fetch`. */
function brokerableDirectTool(toolName: string): boolean {
  return (
    toolName === "read" ||
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "web_fetch"
  );
}

/**
 * Checks one SDK call from a quick-script script against the conversation's
 * current policy. An operation is checked as a `quick_script` request (the
 * operation is the primary argument, its namespace the tool group, its targets
 * `resource` targets); `web.*` and `files.*` are checked as the direct tool
 * they stand for. A person's approval of the script sets a ceiling: a call
 * whose decision is "approval" runs when its own risk is within it and is
 * refused above it. A script merely admitted by a rule has no ceiling, so such
 * calls are refused. Denials always hold.
 */
export function createQuickScriptAuthorizer(
  prepareAdmission: PrepareAdmission,
  registry: QuickScriptRegistry = hostRegistry,
) {
  return async (
    call: QuickScriptCall,
    request: QuickScriptRequest,
  ): Promise<void> => {
    let toolName: string;
    let args: Record<string, unknown>;
    let label: string;
    let risk: QuickScriptRisk;
    if ("operation" in request) {
      const [namespace] = request.operation.split(".");
      // An operation belongs to a namespace, or to an extension's own direct tool (`<extension>.<tool>`).
      if (
        !namespace ||
        !(
          findQuickScriptNamespace(namespace, registry) ??
          registry?.extensions.find((extension) => extension.id === namespace)
        )
      )
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${request.operation}: not available to quick_script`,
        );
      toolName = "quick_script";
      args = {
        operation: request.operation,
        targets: [...request.targets],
        risk: request.risk,
      };
      label = [request.operation, request.targets.join(", ")]
        .filter(Boolean)
        .join(" · ");
      risk = quickScriptRiskOfMethod(request.risk);
    } else {
      const parsed = toolNameSchema.safeParse(request.toolName);
      if (!parsed.success || !brokerableDirectTool(parsed.data))
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${request.toolName}: not available to quick_script`,
        );
      toolName = parsed.data;
      args = request.args;
      label = parsed.data;
      risk = quickScriptToolRisk(parsed.data, request.args);
    }
    const { signal, admission: scripted, ...identity } = call;
    for (let attempt = 0; attempt <= MAX_STALE_RETRIES; attempt += 1) {
      signal.throwIfAborted();
      const admission = await prepareAdmission({
        ...identity,
        toolName,
        args: structuredClone(args),
        target: {
          kind: "quick_script_nested",
          parentToolName: "quick_script",
          toolName,
          cwd: identity.cwd,
        },
      });
      const decision = admission.check();
      if (decision.kind === "stale") continue;
      if (decision.kind === "blocked")
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${label}: permission policy is unavailable until its configuration is repaired`,
        );
      const { decision: verdict, reason } = decision.supervision;
      if (verdict === "deny")
        throw new ToolExecutionError(
          "NESTED_DENIED",
          `${label}: denied${reason ? ` (${reason})` : ""}`,
        );
      if (verdict === "allow") return;
      const suffix = reason ? ` (${reason})` : "";
      if (scripted.by === "rule")
        throw new ToolExecutionError(
          "NESTED_APPROVAL_REQUIRED",
          `${label}: needs ${describeQuickScriptRisk(risk)} approval, but the script was allowed by a rule rather than approved${suffix}`,
        );
      const approvedRisk = scripted.scriptRisk;
      if (quickScriptRiskWithin(risk, approvedRisk)) return;
      throw new ToolExecutionError(
        "NESTED_APPROVAL_REQUIRED",
        `${label}: script was approved for ${describeQuickScriptRisk(approvedRisk)} operations; this call needs ${describeQuickScriptRisk(risk)} approval${suffix}`,
      );
    }
    throw new ToolExecutionError(
      "NESTED_DENIED",
      `${label}: permission policy kept changing; retry`,
      {},
      true,
    );
  };
}
