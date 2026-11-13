import type { StaticToolRisk } from "@nervekit/contracts/permissions";
import type { NormalizedPermissionRequest } from "./permission-policy.js";

/** Method risk of an SDK operation, as quick_script declares it. */
export type OperationRisk =
  | "none"
  | "read"
  | "network"
  | "write"
  | "external_write"
  | "destructive";

/**
 * Base risk rules match for an operation. Reads and network reads keep the
 * direct tools' category; external writes use `unknown`, the category of
 * commands (effective risk `command`), and never `write`, which rule sets may
 * allow for workspace files.
 */
export function operationBaseRisk(risk: OperationRisk): StaticToolRisk {
  switch (risk) {
    case "none":
    case "read":
      return "read";
    case "network":
      return "network";
    case "write":
      return "write";
    case "external_write":
      return "unknown";
    case "destructive":
      return "destructive";
  }
}

/** Request for one quick_script SDK operation: `operation` is the primary argument, the namespace the tool group. */
export function normalizeOperationRequest(input: {
  operation: string;
  /** Normalized resources, `jira:issue/APP-12`. */
  targets: readonly string[];
  risk: OperationRisk;
  conversationId: string;
  projectId?: string;
}): NormalizedPermissionRequest {
  const request: NormalizedPermissionRequest = {
    toolName: "quick_script",
    args: {
      operation: input.operation,
      targets: [...input.targets],
      risk: input.risk,
    },
    primaryArgument: input.operation,
    targets:
      input.targets.length > 0
        ? input.targets.map((value) => ({ kind: "resource", value }))
        : [{ kind: "whole_tool" }],
    conversationId: input.conversationId,
    operation: {
      namespace: input.operation.split(".")[0],
      baseRisk: operationBaseRisk(input.risk),
    },
  };
  request.primaryTarget = request.targets[0];
  if (input.projectId !== undefined) request.projectId = input.projectId;
  return request;
}
