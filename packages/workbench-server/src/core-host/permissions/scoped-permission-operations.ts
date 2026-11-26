import type { ToolRisk } from "@nervekit/contracts/permissions";
import type { OperationRisk } from "@nervekit/tools/policy";
import type { AdmissionPolicySource } from "./execution-admission/admission.js";

/** Names the SDK operations a quick-script script contains, so the approval shows what it does. */
export function withScriptOperations(
  reason: string,
  operations: readonly string[],
): string {
  return operations.length > 0
    ? `${reason} Script operations: ${operations.join(", ")}.`
    : reason;
}

export function extensionIdOf(
  ownerOf: ((namespace: string) => string | undefined) | undefined,
  operation: string,
): { extensionId?: string } {
  const id = ownerOf?.(operation.split(".")[0]);
  return id === undefined ? {} : { extensionId: id };
}

/** The SDK operation a quick-script broker check names, or undefined for any other request. */
export function nestedOperation(
  input: Parameters<AdmissionPolicySource["ensureLoaded"]>[0],
) {
  const target = input.target as { kind?: unknown } | null;
  const args = input.args as {
    operation?: unknown;
    targets?: unknown;
    risk?: unknown;
  };
  if (
    input.toolName !== "quick_script" ||
    target?.kind !== "quick_script_nested" ||
    typeof args.operation !== "string"
  )
    return undefined;
  return {
    operation: args.operation,
    targets: (args.targets as string[] | undefined) ?? [],
    risk: args.risk as OperationRisk,
  };
}

export function operationEffectiveRisk(risk: unknown): ToolRisk {
  switch (risk) {
    case "none":
    case "read":
      return "read";
    case "write":
      return "workspace_write";
    case "external_write":
      return "external_write";
    case "destructive":
      return "destructive";
    default:
      return "external_read";
  }
}
