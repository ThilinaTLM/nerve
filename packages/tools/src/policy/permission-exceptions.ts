import { createHash } from "node:crypto";
import type {
  PermissionException,
  PermissionSelector,
  ToolName,
  ToolRisk,
} from "@nervekit/contracts";
import { requireToolDefinition } from "../catalog/manifest.js";
import {
  commandPrefixMatches,
  suggestedCommandPrefix,
} from "./shell-command-assessment.js";
import { pathGlobMatches, webHostMatches } from "./path-glob.js";
import type { PermissionTarget, ToolRiskAssessment } from "./types.js";

type PermissionExceptionDraft = PermissionException extends infer T
  ? T extends { id: string }
    ? Omit<T, "id">
    : never
  : never;

const NEVER_DURABLE_RISKS = new Set<ToolRisk>([
  "destructive",
  "secret",
  "deployment",
]);

export function permissionExceptionKey(
  exception: PermissionExceptionDraft | PermissionException,
): string {
  return JSON.stringify({
    effect: exception.effect,
    ...(exception.effect === "allow" ? { risk: exception.risk } : {}),
    selector: exception.selector,
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
  return {
    ...exception,
    id: permissionExceptionId(exception),
  } as PermissionException;
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
      selectorMatchesRequest(exception.selector, input.toolName, input.targets),
  );
}

export function coveringAllowExceptions(input: {
  toolName: ToolName;
  risk: ToolRisk;
  targets: readonly PermissionTarget[];
  exceptions: readonly PermissionException[];
}): PermissionException[] {
  const candidates = input.exceptions.filter(
    (exception) =>
      exception.effect === "allow" && exception.risk === input.risk,
  );
  const requiredTargets = input.targets.filter(
    (target) => target.kind !== "command_segment" || target.risk !== "read",
  );
  if (requiredTargets.length === 0) {
    return candidates.filter(
      (exception) =>
        exception.selector.kind === "tool" &&
        exception.selector.toolName === input.toolName,
    );
  }
  const matched = new Map<string, PermissionException>();
  for (const target of requiredTargets) {
    const covering = candidates.filter((exception) =>
      selectorMatchesTarget(exception.selector, input.toolName, target),
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
    let selector: PermissionSelector | undefined;
    if (target.kind === "command_segment") {
      const tokens = suggestedCommandPrefix(target.normalizedTokens);
      if (tokens.length) selector = { kind: "command_prefix", tokens };
    } else if (target.kind === "path" && target.projectRelativePath) {
      selector = {
        kind: "path_glob",
        access: target.access,
        pattern: escapePathGlob(target.projectRelativePath),
      };
    } else if (target.kind === "web_host") {
      selector = { kind: "web_host", pattern: target.host };
    }
    if (selector) {
      result.push(
        withPermissionExceptionId({
          effect: "allow",
          risk: input.assessment.risk,
          selector,
        }),
      );
    }
  }
  if (result.length === 0 && durableAllow === "tool") {
    result.push(
      withPermissionExceptionId({
        effect: "allow",
        risk: input.assessment.risk,
        selector: { kind: "tool", toolName: input.toolName },
      }),
    );
  }
  return deduplicatePermissionExceptions(result);
}

function selectorMatchesRequest(
  selector: PermissionSelector,
  toolName: ToolName,
  targets: readonly PermissionTarget[],
): boolean {
  if (selector.kind === "tool") return selector.toolName === toolName;
  return targets.some((target) =>
    selectorMatchesTarget(selector, toolName, target),
  );
}

function selectorMatchesTarget(
  selector: PermissionSelector,
  toolName: ToolName,
  target: PermissionTarget,
): boolean {
  if (selector.kind === "tool") return selector.toolName === toolName;
  if (selector.kind === "command_prefix") {
    return (
      target.kind === "command_segment" &&
      commandPrefixMatches(target.normalizedTokens, selector.tokens)
    );
  }
  if (selector.kind === "web_host") {
    return (
      target.kind === "web_host" &&
      webHostMatches(target.host, selector.pattern)
    );
  }
  if (target.kind !== "path" || !target.projectRelativePath) return false;
  const accessMatches =
    selector.access === "read_write" || selector.access === target.access;
  return (
    accessMatches &&
    pathTargetMatchesGlob(
      target.projectRelativePath,
      target.scope,
      selector.pattern,
    )
  );
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

function escapePathGlob(path: string): string {
  return path
    .replaceAll("[", "[[]")
    .replaceAll("*", "[*]")
    .replaceAll("?", "[?]");
}
