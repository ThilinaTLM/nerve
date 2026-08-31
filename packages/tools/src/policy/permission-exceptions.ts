import { createHash } from "node:crypto";
import type {
  PermissionException,
  ToolRisk,
} from "@nervekit/contracts/permissions";
import type { ToolName } from "@nervekit/contracts/tools";
import { requireToolDefinition } from "../catalog/manifest.js";
import {
  pathGlobMatches,
  patternMatches,
  escapeGlobLiteral,
} from "./path-glob.js";
import type { PermissionTarget, ToolRiskAssessment } from "./types.js";

type PermissionExceptionDraft = Omit<PermissionException, "id">;

const NEVER_DURABLE_RISKS = new Set<ToolRisk>([
  "destructive",
  "secret",
  "deployment",
]);

export function permissionExceptionKey(
  exception: PermissionExceptionDraft | PermissionException,
): string {
  return JSON.stringify({
    tool: exception.tool,
    effect: exception.effect,
    rule: exception.rule,
  });
}

export function permissionExceptionId(
  exception: PermissionExceptionDraft,
): string {
  return `exception_${createHash("sha256").update(permissionExceptionKey(exception)).digest("hex").slice(0, 24)}`;
}

export function withPermissionExceptionId(
  exception: PermissionExceptionDraft,
): PermissionException {
  return { ...exception, id: permissionExceptionId(exception) };
}

export function deduplicatePermissionExceptions(
  exceptions: readonly PermissionException[],
): PermissionException[] {
  const seen = new Set<string>();
  return exceptions.filter((exception) => {
    const key = permissionExceptionKey(exception);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function matchingDenyExceptions(input: {
  toolName: ToolName;
  targets: readonly PermissionTarget[];
  exceptions: readonly PermissionException[];
}): PermissionException[] {
  return input.exceptions.filter(
    (exception) =>
      exception.effect === "deny" &&
      exception.tool === input.toolName &&
      ruleMatchesRequest(exception.rule, input.toolName, input.targets),
  );
}

export function coveringAllowExceptions(input: {
  toolName: ToolName;
  risk: ToolRisk;
  targets: readonly PermissionTarget[];
  exceptions: readonly PermissionException[];
}): PermissionException[] {
  if (NEVER_DURABLE_RISKS.has(input.risk)) return [];
  const definition = requireToolDefinition(input.toolName);
  if ((definition.permission?.durableAllow ?? "tool") === "never") return [];
  const candidates = input.exceptions.filter(
    (exception) =>
      exception.effect === "allow" && exception.tool === input.toolName,
  );
  const requiredTargets = input.targets.filter(
    (target) => target.kind !== "command_segment" || target.risk !== "read",
  );
  if (requiredTargets.length === 0) {
    return candidates.filter((exception) => exception.rule === "*");
  }
  const matched = new Map<string, PermissionException>();
  for (const target of requiredTargets) {
    const covering = candidates.filter((exception) =>
      ruleMatchesTarget(exception.rule, input.toolName, target),
    );
    if (covering.length === 0) return [];
    for (const exception of covering) matched.set(exception.id, exception);
  }
  return [...matched.values()];
}

export function suggestedPermissionExceptions(input: {
  toolName: ToolName;
  assessment: ToolRiskAssessment;
  targets: readonly PermissionTarget[];
}): PermissionException[] {
  const durableAllow =
    requireToolDefinition(input.toolName).permission?.durableAllow ?? "tool";
  if (
    durableAllow === "never" ||
    input.assessment.risk === "read" ||
    NEVER_DURABLE_RISKS.has(input.assessment.risk)
  ) {
    return [];
  }
  const result: PermissionException[] = [];
  for (const target of durableAllow === "target" ? input.targets : []) {
    if (target.kind === "command_segment" && target.risk === "read") continue;
    let rule: string | undefined;
    if (target.kind === "command_segment") {
      rule = escapeGlobLiteral(target.normalizedTokens.join(" "));
    } else if (target.kind === "path" && target.projectRelativePath) {
      rule = escapeGlobLiteral(target.projectRelativePath);
    } else if (target.kind === "web_url") {
      rule = escapeGlobLiteral(target.url);
    }
    if (rule) {
      result.push(
        withPermissionExceptionId({
          tool: input.toolName,
          effect: "allow",
          rule,
        }),
      );
    }
  }
  if (result.length === 0 && durableAllow === "tool") {
    result.push(
      withPermissionExceptionId({
        tool: input.toolName,
        effect: "allow",
        rule: "*",
      }),
    );
  }
  return deduplicatePermissionExceptions(result);
}

function ruleMatchesRequest(
  rule: string,
  toolName: ToolName,
  targets: readonly PermissionTarget[],
): boolean {
  const definition = requireToolDefinition(toolName);
  if (!definition.permission?.targets?.length) return rule === "*";
  return targets.some((target) => ruleMatchesTarget(rule, toolName, target));
}

function ruleMatchesTarget(
  rule: string,
  toolName: ToolName,
  target: PermissionTarget,
): boolean {
  const targetKind =
    requireToolDefinition(toolName).permission?.targets?.[0]?.kind;
  if (targetKind === "command_segments") {
    return (
      target.kind === "command_segment" &&
      patternMatches(target.normalizedTokens.join(" "), rule)
    );
  }
  if (targetKind === "web_host") {
    return target.kind === "web_url" && patternMatches(target.url, rule);
  }
  if (
    targetKind !== "path" ||
    target.kind !== "path" ||
    !target.projectRelativePath
  ) {
    return false;
  }
  return pathTargetMatchesGlob(target.projectRelativePath, target.scope, rule);
}

function pathTargetMatchesGlob(
  path: string,
  scope: "exact" | "tree",
  pattern: string,
): boolean {
  if (pathGlobMatches(path, pattern)) return true;
  if (scope !== "tree") return false;
  const literalPrefix = pattern.split(/[?*[{]/, 1)[0]?.replace(/\/$/, "") ?? "";
  if (path === ".") return true;
  return literalPrefix === path || literalPrefix.startsWith(`${path}/`);
}
