import type { ToolRisk } from "@nervekit/contracts/permissions";
import { type ToolName, toolNameSchema } from "@nervekit/contracts/tools";
import { classifyToolRisk } from "../../catalog/index.js";
import {
  isOperationCheck,
  type MethodRisk,
  type NestedCheck,
} from "./sdk-types.js";

/**
 * Risk of a quick-script script, from its text, before it runs. Approval is for
 * the script as a whole; the broker still checks every SDK call at runtime
 * against this ceiling, so a script that hides a call from the scanner is
 * refused when it makes it.
 */
export type QuickScriptRisk =
  | "read"
  | "external_read"
  | "workspace_write"
  | "external_write"
  | "destructive";

/** Workspace and external writes share a rank: either ceiling admits the other. */
const RANK: Record<QuickScriptRisk, number> = {
  read: 0,
  external_read: 1,
  workspace_write: 2,
  external_write: 2,
  destructive: 3,
};

export function quickScriptRiskWithin(
  risk: QuickScriptRisk,
  ceiling: QuickScriptRisk,
): boolean {
  return RANK[risk] <= RANK[ceiling];
}

/** The riskier of two; on a rank tie `external_write` wins, so the result does not depend on order. */
export function higherRisk(
  a: QuickScriptRisk,
  b: QuickScriptRisk,
): QuickScriptRisk {
  if (RANK[a] !== RANK[b]) return RANK[a] > RANK[b] ? a : b;
  return a === "external_write" || b === "external_write"
    ? "external_write"
    : a;
}

export function describeQuickScriptRisk(risk: QuickScriptRisk): string {
  return risk.replaceAll("_", " ");
}

/** Maps the effective risk of one direct tool call onto the quick-script scale; anything beyond reads and writes is destructive. */
export function quickScriptRiskOfToolRisk(risk: ToolRisk): QuickScriptRisk {
  switch (risk) {
    case "read":
    case "interaction":
      return "read";
    case "external_read":
      return "external_read";
    case "workspace_write":
      return "workspace_write";
    case "command":
      return "external_write";
    default:
      return "destructive";
  }
}

/** Risk of one nested call: the direct tool's argument-aware risk, so `comments.add` is a write while a delete is destructive. */
export function quickScriptToolRisk(
  toolName: ToolName | string,
  args: Record<string, unknown> = {},
  /** The project directory whose installed extensions' direct tools are looked up. */
  scope?: string,
): QuickScriptRisk {
  return quickScriptRiskOfToolRisk(classifyToolRisk(toolName, args, scope));
}

/** Risk a method's declaration stands for on the quick-script scale. */
export function quickScriptRiskOfMethod(risk: MethodRisk): QuickScriptRisk {
  switch (risk) {
    case "none":
    case "read":
      return "read";
    case "external_read":
      return "external_read";
    case "write":
      return "workspace_write";
    case "external_write":
      return "external_write";
    case "destructive":
      return "destructive";
  }
}

/**
 * Guards the declaration against the authorization: a method must not be
 * declared as less risky than the check it runs (an operation's own risk, or
 * the direct tool call it is authorized as), or the script scan would
 * under-report what the call does.
 */
export function assertDeclaredRisk(
  name: string,
  declared: MethodRisk,
  authorizations: readonly NestedCheck[],
): void {
  const ceiling =
    declared === "none" ? -1 : RANK[quickScriptRiskOfMethod(declared)];
  for (const check of authorizations) {
    let effective: QuickScriptRisk;
    let label: string;
    if (isOperationCheck(check)) {
      effective = quickScriptRiskOfMethod(check.risk);
      label = check.operation;
    } else {
      const parsed = toolNameSchema.safeParse(check.toolName);
      effective = parsed.success
        ? quickScriptToolRisk(parsed.data, check.args)
        : "destructive";
      label = check.toolName;
    }
    if (RANK[effective] > ceiling) {
      throw new Error(
        `Internal error: ${name} declares risk "${declared}" but is authorized as ${label} with ${describeQuickScriptRisk(effective)} risk; fix the method's risk declaration.`,
      );
    }
  }
}
