import { createHash } from "node:crypto";
import type {
  PermissionEvaluationResult,
  PermissionRule,
  StaticToolRisk,
} from "@nervekit/contracts/permissions";
import {
  type EffectivePermissionPolicy,
  type NormalizedPermissionRequest,
  evaluatePermissionRequest,
} from "./permission-policy.js";
import { escapeGlobLiteral } from "./path-glob.js";

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

/** One SDK call a script's scan found: its operation, risk and normalized targets (undefined when only known at run time). */
export interface ScriptOperationCall {
  operation: string;
  risk: OperationRisk;
  targets?: readonly string[];
}

export interface ScriptAdmission {
  result: PermissionEvaluationResult;
  /** Operation rules decided the script (allow or deny); otherwise `result` is the script-level decision. */
  byOperations: boolean;
}

const MAX_SUGGESTIONS = 16;

/** A rule names an operation or a resource, as opposed to a risk class or tool group. */
export function isOperationRule(rule: PermissionRule): boolean {
  return (
    rule.when.primaryArgument !== undefined ||
    rule.when.primaryTarget?.kind === "resource" ||
    rule.when.targets?.matcher.kind === "resource"
  );
}

/** -1, 0, 1 as `a` ranks below, equal to or above `b` in rule precedence. */
function comparePrecedence(
  a: PermissionEvaluationResult["winningRulePrecedence"],
  b: PermissionEvaluationResult["winningRulePrecedence"],
): number {
  return (
    Math.sign(a.enforcementRank - b.enforcementRank) ||
    Math.sign(a.scopeRank - b.scopeRank) ||
    Math.sign(a.priority - b.priority)
  );
}

/**
 * Composes a script's admission with operation rules. `script` is the
 * script-level decision (its classified risk against risk-class rules); `calls`
 * are the operations of a complete scan.
 *
 * - An operation rule (or guardrail) that denies any call denies the script.
 * - Otherwise, when every call is allowed by an operation rule that outranks
 *   the script-level rule, the script is allowed by rule.
 * - Anything else keeps the script-level decision, with operation-scoped
 *   suggestions for the calls no operation rule allows.
 *
 * A call with unknown targets is evaluated without targets, so only rules that
 * do not match on targets can allow or deny it here; the run-time check sees
 * the real targets. Rule sets with no operation rules (the built-in ones) never
 * change the script-level decision.
 */
export function composeScriptAdmission(input: {
  script: PermissionEvaluationResult;
  calls: readonly ScriptOperationCall[];
  policy: EffectivePermissionPolicy;
  conversationId: string;
  projectId?: string;
}): ScriptAdmission {
  const { script, calls, policy } = input;
  if (calls.length === 0) return { result: script, byOperations: false };
  const checked = calls.map((call) => ({
    call,
    result: evaluatePermissionRequest({
      policy,
      request: normalizeOperationRequest({
        operation: call.operation,
        targets: call.targets ?? [],
        risk: call.risk,
        conversationId: input.conversationId,
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
      }),
    }),
  }));
  const label = (call: ScriptOperationCall) =>
    [call.operation, (call.targets ?? []).join(", ")]
      .filter(Boolean)
      .join(" · ");
  const binding = (result: PermissionEvaluationResult) =>
    isOperationRule(result.winningRule) ||
    result.winningRuleEnforcement === "guardrail";

  const denied = checked.find(
    ({ result }) => result.decision === "deny" && binding(result),
  );
  if (denied)
    return {
      result: {
        ...denied.result,
        reason: `${label(denied.call)}: ${denied.result.reason}`,
        suggestedRules: [],
      },
      byOperations: true,
    };

  const allowedByRule = (entry: (typeof checked)[number]) =>
    entry.result.decision === "allow" &&
    isOperationRule(entry.result.winningRule);
  if (script.decision === "allow")
    return { result: script, byOperations: false };
  if (checked.every(allowedByRule)) {
    const weakest = checked.reduce((low, entry) =>
      comparePrecedence(
        entry.result.winningRulePrecedence,
        low.result.winningRulePrecedence,
      ) < 0
        ? entry
        : low,
    );
    if (
      comparePrecedence(
        weakest.result.winningRulePrecedence,
        script.winningRulePrecedence,
      ) > 0
    )
      return {
        result: {
          ...weakest.result,
          reason: `Operation rules allow every operation of this script: ${[
            ...new Set(checked.map(({ call }) => label(call))),
          ].join("; ")}.`,
          suggestedRules: [],
        },
        byOperations: true,
      };
  }
  return {
    result: {
      ...script,
      suggestedRules:
        script.decision === "prompt"
          ? suggestOperationRules(
              checked
                .filter((entry) => !allowedByRule(entry))
                .map((e) => e.call),
            )
          : [],
    },
    byOperations: false,
  };
}

/**
 * Allow rules for the operations of a script: each operation with its exact
 * targets when they are known, otherwise the operation alone. Persisting a
 * suggestion writes all of them. Empty when there are too many to list.
 */
export function suggestOperationRules(
  calls: readonly ScriptOperationCall[],
): PermissionRule[] {
  const rules = new Map<string, PermissionRule>();
  for (const call of calls) {
    const targets = [...new Set(call.targets ?? [])].sort();
    const when: PermissionRule["when"] = {
      toolNames: ["quick_script"],
      primaryArgument: { operator: "equals", value: call.operation },
    };
    if (targets.length > 0)
      when.targets = {
        quantifier: "all",
        matcher: {
          kind: "resource",
          pattern:
            targets.length === 1
              ? escapeGlobLiteral(targets[0])
              : `{${targets
                  .map((target) =>
                    escapeGlobLiteral(target).replaceAll(",", "[,]"),
                  )
                  .join(",")}}`,
        },
      };
    const digest = createHash("sha256")
      .update(JSON.stringify(when))
      .digest("hex")
      .slice(0, 16);
    const id = `allow-quick_script-${digest}`;
    rules.set(id, {
      id,
      description: `Allow ${call.operation}${targets.length > 0 ? ` on ${targets.join(", ")}` : ""}.`,
      enabled: true,
      priority: 0,
      enforcement: "overridable",
      when,
      decision: "allow",
    });
  }
  return rules.size <= MAX_SUGGESTIONS ? [...rules.values()] : [];
}
