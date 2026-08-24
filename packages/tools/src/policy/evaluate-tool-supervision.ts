import { createHash } from "node:crypto";
import type {
  Mode,
  NormalizedPermissionTarget,
  PermissionLevel,
  PermissionRule,
  PermissionRuleMatcherKind,
  SupervisionDecision,
  ToolName,
  ToolRisk,
} from "@nervekit/contracts";
import { requireToolDefinition } from "../catalog/manifest.js";
import {
  escapeGlobLiteral,
  pathGlobMatches,
  patternMatches,
} from "./path-glob.js";
import { permissionTargets } from "./permission-targets.js";
import { assessToolRisk } from "./tool-risk-assessment.js";
import type { PermissionTarget, ToolPolicyConstraint } from "./types.js";

export interface ToolSupervisionInput {
  toolName: ToolName;
  args: Record<string, unknown>;
  normalizedArgs?: Record<string, unknown>;
  mode: Mode;
  permissionLevel: PermissionLevel;
  projectId: string;
  projectDir: string;
  cwd?: string;
  rules: readonly PermissionRule[];
  constraints?: readonly ToolPolicyConstraint[];
  evaluatedAt: string;
}

const NEVER_DURABLE_RISKS = new Set<ToolRisk>([
  "destructive",
  "secret",
  "deployment",
]);
const NON_LOWERABLE_CATALOG_RISKS = new Set<ToolRisk>([
  "destructive",
  "secret",
  "deployment",
  "agent_spawn",
]);

/** Pure, deterministic, fail-closed supervision policy evaluation. */
export function evaluateToolSupervision(
  input: ToolSupervisionInput,
): SupervisionDecision {
  const definition = requireToolDefinition(input.toolName);
  const normalizedArgs = input.normalizedArgs ?? { ...input.args };
  const assessment = assessToolRisk(input.toolName, normalizedArgs);
  const effectiveRisk = NON_LOWERABLE_CATALOG_RISKS.has(definition.baseRisk)
    ? definition.baseRisk
    : assessment.risk;
  const rawTargets = permissionTargets({
    toolName: input.toolName,
    args: normalizedArgs,
    cwd: input.cwd,
    projectDir: input.projectDir,
    command: assessment.command,
  });
  const normalizedTargets = normalizeTargets(
    rawTargets,
    definition.permission?.targets?.length === 0,
  );
  const applicableRules = input.rules
    .filter(
      (rule) =>
        rule.enabled &&
        rule.toolName === input.toolName &&
        (rule.scope === "user" || rule.projectId === input.projectId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const policySnapshotHash = hashPolicySnapshot({
    version: 1,
    toolName: input.toolName,
    mode: input.mode,
    permissionLevel: input.permissionLevel,
    projectId: input.projectId,
    projectDir: input.projectDir,
    cwd: input.cwd ?? input.projectDir,
    descriptor: {
      baseRisk: definition.baseRisk,
      traits: [...definition.traits].sort(),
      executionKind: definition.executionKind,
      durableAllow: definition.permission?.durableAllow ?? "tool",
      targets: definition.permission?.targets ?? [],
    },
    rules: applicableRules.map((rule) => {
      const snapshot = { ...rule } as Partial<PermissionRule>;
      delete snapshot.createdAt;
      delete snapshot.updatedAt;
      return snapshot;
    }),
  });
  const base = {
    version: 1 as const,
    effectiveRisk,
    normalizedArgs,
    normalizedTargets,
    policySnapshotHash,
  };

  const validationDenial = validationFailure(
    input,
    rawTargets,
    assessment.command?.supported,
  );
  const constraint = input.constraints?.[0];
  if (validationDenial || constraint) {
    return {
      ...base,
      decision: "deny",
      reason:
        validationDenial ?? constraint?.reason ?? "Policy denied the request.",
      matchedRuleIds: [],
      suggestedRules: [],
    };
  }

  const matchingRules = applicableRules.filter((rule) =>
    ruleMatchesRequest(rule, rawTargets),
  );
  const denials = matchingRules.filter((rule) => rule.effect === "deny");
  if (denials.length > 0) {
    return {
      ...base,
      decision: "deny",
      reason: "A matching permission rule denies this request.",
      matchedRuleIds: matchingRules.map((rule) => rule.id).sort(),
      suggestedRules: [],
    };
  }

  if (input.permissionLevel === "read_only") {
    const allowed = effectiveRisk === "read" || effectiveRisk === "interaction";
    return {
      ...base,
      decision: allowed ? "allow" : "deny",
      reason: allowed
        ? "Read only permits local inspection and user interaction."
        : "Read only blocks commands, network access, secrets, deployment, and mutations.",
      matchedRuleIds: [],
      suggestedRules: [],
    };
  }

  if (effectiveRisk === "interaction") {
    return {
      ...base,
      decision: "allow",
      reason: "User interaction tools execute as the interaction boundary.",
      matchedRuleIds: [],
      suggestedRules: [],
    };
  }

  if (input.permissionLevel === "autonomous") {
    return {
      ...base,
      decision: "allow",
      reason: "Autonomous permission allows this request.",
      matchedRuleIds: [],
      suggestedRules: [],
    };
  }

  const readLike =
    effectiveRisk === "read" || definition.traits.includes("read_only_network");
  if (readLike) {
    return {
      ...base,
      decision: "allow",
      reason: "Supervised permission automatically allows safe reads.",
      matchedRuleIds: [],
      suggestedRules: [],
    };
  }

  const approvals = coveringAllowRules(
    applicableRules,
    rawTargets,
    definition.permission?.durableAllow ?? "tool",
    effectiveRisk,
  );
  if (approvals.length > 0) {
    return {
      ...base,
      decision: "allow",
      reason: "Matching permission rules cover every required target.",
      matchedRuleIds: approvals.map((rule) => rule.id),
      suggestedRules: [],
    };
  }

  return {
    ...base,
    decision: "prompt",
    reason: "Supervised permission requires approval for this request.",
    matchedRuleIds: [],
    suggestedRules: suggestedRules(input, rawTargets, effectiveRisk),
  };
}

function validationFailure(
  input: ToolSupervisionInput,
  targets: readonly PermissionTarget[],
  commandSupported: boolean | undefined,
): string | undefined {
  if (input.mode === "planning" && input.constraints?.length) {
    return input.constraints[0]?.reason;
  }
  const descriptor = requireToolDefinition(input.toolName);
  if (
    (descriptor.permission?.targets?.length ?? 0) > 0 &&
    targets.length === 0
  ) {
    return "Tool targets are missing or malformed.";
  }
  if (input.toolName === "bash" && commandSupported === false) {
    return undefined; // May still be approved once; it can never match a durable allow.
  }
  return undefined;
}

function coveringAllowRules(
  rules: readonly PermissionRule[],
  targets: readonly PermissionTarget[],
  durableAllow: "never" | "tool" | "target",
  risk: ToolRisk,
): PermissionRule[] {
  if (durableAllow === "never" || NEVER_DURABLE_RISKS.has(risk)) return [];
  const allows = rules.filter((rule) => rule.effect === "allow");
  if (durableAllow === "tool") {
    return allows.filter(
      (rule) => rule.matcherKind === "whole_tool" && rule.pattern === "*",
    );
  }
  const required = targets.filter(
    (target) => target.kind !== "command_segment" || target.risk !== "read",
  );
  if (required.length === 0) return [];
  const matched = new Map<string, PermissionRule>();
  for (const target of required) {
    const covering = allows.filter((rule) => ruleMatchesTarget(rule, target));
    if (covering.length === 0) return [];
    for (const rule of covering) matched.set(rule.id, rule);
  }
  return [...matched.values()];
}

function ruleMatchesRequest(
  rule: PermissionRule,
  targets: readonly PermissionTarget[],
): boolean {
  if (rule.matcherKind === "whole_tool") return rule.pattern === "*";
  return targets.some((target) => ruleMatchesTarget(rule, target));
}

function ruleMatchesTarget(
  rule: PermissionRule,
  target: PermissionTarget,
): boolean {
  if (rule.matcherKind === "command_glob") {
    return (
      target.kind === "command_segment" &&
      patternMatches(target.normalizedTokens.join(" "), rule.pattern)
    );
  }
  if (rule.matcherKind === "url_glob") {
    return (
      target.kind === "web_url" && patternMatches(target.url, rule.pattern)
    );
  }
  if (rule.matcherKind !== "path_glob" || target.kind !== "path") return false;
  const path = target.projectRelativePath;
  if (!path) return false;
  if (pathGlobMatches(path, rule.pattern)) return true;
  if (target.scope !== "tree") return false;
  const literalPrefix =
    rule.pattern.split(/[?*[{]/, 1)[0]?.replace(/\/$/, "") ?? "";
  return (
    path === "." ||
    literalPrefix === path ||
    literalPrefix.startsWith(`${path}/`)
  );
}

function suggestedRules(
  input: ToolSupervisionInput,
  targets: readonly PermissionTarget[],
  risk: ToolRisk,
): PermissionRule[] {
  const definition = requireToolDefinition(input.toolName);
  const durableAllow = definition.permission?.durableAllow ?? "tool";
  if (durableAllow === "never" || NEVER_DURABLE_RISKS.has(risk)) return [];
  if (
    input.toolName === "bash" &&
    assessToolRisk("bash", input.normalizedArgs ?? input.args).command
      ?.supported === false
  ) {
    return [];
  }
  const drafts: Array<{
    matcherKind: PermissionRuleMatcherKind;
    pattern: string;
  }> = [];
  if (durableAllow === "tool") {
    drafts.push({ matcherKind: "whole_tool", pattern: "*" });
  } else {
    for (const target of targets) {
      if (target.kind === "command_segment" && target.risk !== "read") {
        drafts.push({
          matcherKind: "command_glob",
          pattern: escapeGlobLiteral(target.normalizedTokens.join(" ")),
        });
      } else if (target.kind === "path" && target.projectRelativePath) {
        drafts.push({
          matcherKind: "path_glob",
          pattern: escapeGlobLiteral(target.projectRelativePath),
        });
      } else if (target.kind === "web_url") {
        drafts.push({
          matcherKind: "url_glob",
          pattern: escapeGlobLiteral(target.url),
        });
      }
    }
  }
  const unique = new Map<string, PermissionRule>();
  for (const draft of drafts) {
    const identity = `${input.toolName}\0${draft.matcherKind}\0${draft.pattern}`;
    const id = `rule_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
    unique.set(identity, {
      id,
      scope: "project",
      projectId: input.projectId,
      effect: "allow",
      toolName: input.toolName,
      matcherKind: draft.matcherKind,
      pattern: draft.pattern,
      enabled: true,
      createdAt: input.evaluatedAt,
      updatedAt: input.evaluatedAt,
    });
  }
  return [...unique.values()];
}

function normalizeTargets(
  targets: readonly PermissionTarget[],
  wholeTool: boolean,
): NormalizedPermissionTarget[] {
  const normalized = targets.map((target): NormalizedPermissionTarget => {
    if (target.kind === "web_url") return { kind: "url", url: target.url };
    return target;
  });
  if (normalized.length === 0 && wholeTool)
    normalized.push({ kind: "whole_tool" });
  return normalized;
}

function hashPolicySnapshot(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
