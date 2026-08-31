import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Value } from "typebox/value";
import type {
  ComparableValue,
  IgnoredPermissionSource,
  PathRoot,
  PermissionEvaluationResult,
  PermissionOverlay,
  PermissionRule,
  PermissionRuleOrigin,
  PermissionRuleSet,
  PermissionTarget,
  PrimitiveValue,
  RulePrecedence,
  StaticToolRisk,
  TargetMatcher,
  ValueMatcher,
} from "@nervekit/contracts/permissions";
import type { ToolName } from "@nervekit/contracts/tools";
import { permissionRuleSetSchema } from "@nervekit/contracts/permissions";
import autonomousJson from "./rule-sets/autonomous.json" with { type: "json" };
import baselineJson from "./rule-sets/baseline.json" with { type: "json" };
import planningJson from "./rule-sets/planning.json" with { type: "json" };
import readOnlyJson from "./rule-sets/read_only.json" with { type: "json" };
import supervisedJson from "./rule-sets/supervised.json" with { type: "json" };
import { normalizeToolArguments } from "../catalog/argument-normalization.js";
import { permissionMetadataForTool } from "../catalog/permission-metadata.js";
import { requireToolDefinition } from "../catalog/manifest.js";
import { escapeGlobLiteral, patternMatches } from "./path-glob.js";

export interface PermissionRootPaths {
  project: string;
  nerve_home: string;
  nerve_data: string;
  plans: string;
}

export interface NormalizedPermissionRequest {
  toolName: ToolName;
  args: Record<string, unknown>;
  primaryArgument?: unknown;
  primaryTarget?: PermissionTarget;
  targets: PermissionTarget[];
  projectId?: string;
  conversationId: string;
}

export interface EffectivePermissionRule {
  rule: PermissionRule;
  origin: PermissionRuleOrigin;
  sourceId: string;
  precedence: RulePrecedence;
}

export interface EffectivePermissionPolicy {
  rules: readonly EffectivePermissionRule[];
  activeRuleSetIds: readonly string[];
  ignoredOverlays: readonly IgnoredPermissionSource[];
  snapshotHash: string;
  subagent: boolean;
}

export interface ComposePermissionPolicyInput {
  selectedRuleSet: PermissionRuleSet;
  userOverlay?: PermissionOverlay;
  projectOverlay?: PermissionOverlay;
  conversationOverlay?: PermissionOverlay;
  ignoredOverlays?: readonly IgnoredPermissionSource[];
  subagent?: boolean;
}

export interface EvaluatePermissionInput {
  request: NormalizedPermissionRequest;
  policy: EffectivePermissionPolicy;
}

const builtIns = [
  baselineJson,
  readOnlyJson,
  supervisedJson,
  autonomousJson,
  planningJson,
].map((value) => deepFreeze(permissionRuleSetSchema.parse(value)));

export const builtInPermissionRuleSets: readonly PermissionRuleSet[] =
  Object.freeze(builtIns);

const builtInById = new Map(builtIns.map((ruleSet) => [ruleSet.id, ruleSet]));

export function builtInPermissionRuleSet(id: string): PermissionRuleSet {
  const ruleSet = builtInById.get(id);
  if (!ruleSet) throw new Error(`Unknown built-in permission rule set: ${id}`);
  return ruleSet;
}

export function composeEffectivePermissionPolicy(
  input: ComposePermissionPolicyInput,
): EffectivePermissionPolicy {
  const subagent = input.subagent === true;
  const entries: EffectivePermissionRule[] = [];
  const activeRuleSetIds: string[] = [];
  if (!subagent) {
    const baseline = builtInPermissionRuleSet("baseline");
    activeRuleSetIds.push(baseline.id);
    appendRules(entries, baseline.rules, "baseline", baseline.id);
  }
  if (subagent || input.selectedRuleSet.id !== "baseline") {
    activeRuleSetIds.push(input.selectedRuleSet.id);
    appendRules(
      entries,
      input.selectedRuleSet.rules,
      "rule_set",
      input.selectedRuleSet.id,
    );
  }
  if (!subagent) {
    appendRules(entries, input.userOverlay?.rules ?? [], "user", "user");
    appendRules(
      entries,
      input.projectOverlay?.rules ?? [],
      "project",
      "project",
    );
    appendRules(
      entries,
      input.conversationOverlay?.rules ?? [],
      "conversation",
      "conversation",
    );
  }
  const ignoredOverlays = [...(input.ignoredOverlays ?? [])];
  const snapshotHash = hashCanonical({
    version: 1,
    subagent,
    activeRuleSetIds,
    sources: {
      baseline: subagent ? undefined : builtInPermissionRuleSet("baseline"),
      selectedRuleSet: input.selectedRuleSet,
      userOverlay: subagent ? undefined : input.userOverlay,
      projectOverlay: subagent ? undefined : input.projectOverlay,
      conversationOverlay: subagent ? undefined : input.conversationOverlay,
    },
    ignoredOverlays,
    rules: entries.map(({ rule, origin, sourceId, precedence }) => ({
      rule,
      origin,
      sourceId,
      precedence,
    })),
  });
  return deepFreeze({
    rules: entries,
    activeRuleSetIds,
    ignoredOverlays,
    snapshotHash,
    subagent,
  });
}

function appendRules(
  destination: EffectivePermissionRule[],
  rules: readonly PermissionRule[],
  origin: PermissionRuleOrigin,
  sourceId: string,
): void {
  for (const rule of rules) {
    destination.push({
      rule,
      origin,
      sourceId,
      precedence: precedenceFor(rule, origin),
    });
  }
}

function precedenceFor(
  rule: PermissionRule,
  origin: PermissionRuleOrigin,
): RulePrecedence {
  return {
    enforcementRank: rule.enforcement === "guardrail" ? 1 : 0,
    scopeRank:
      rule.enforcement === "guardrail"
        ? 0
        : { baseline: 0, rule_set: 1, user: 2, project: 3, conversation: 4 }[
            origin
          ],
    priority: rule.priority,
  };
}

export function normalizePermissionRequest(input: {
  toolName: ToolName;
  args: Record<string, unknown>;
  normalizedArgs?: Record<string, unknown>;
  roots: PermissionRootPaths;
  cwd?: string;
  projectId?: string;
  conversationId: string;
}): NormalizedPermissionRequest {
  const definition = requireToolDefinition(input.toolName);
  const metadata = permissionMetadataForTool(input.toolName);
  const args =
    input.normalizedArgs ?? normalizeToolArguments(definition, input.args);
  if (!Value.Check(definition.parameters, args)) {
    throw new Error(`Invalid validated arguments for ${input.toolName}.`);
  }
  const primaryArgument = metadata.primaryArguments
    .map((name) => args[name])
    .find((value) => value !== undefined);
  const targets = extractTargets(
    input.toolName,
    args,
    input.roots,
    input.cwd ?? input.roots.project,
  );
  if (
    metadata.targetKinds.some((kind) => kind !== "whole_tool") &&
    targets.length === 0
  ) {
    throw new Error(
      `Required permission targets could not be derived for ${input.toolName}.`,
    );
  }
  const request: NormalizedPermissionRequest = {
    toolName: input.toolName,
    args,
    targets,
    conversationId: input.conversationId,
  };
  if (primaryArgument !== undefined) request.primaryArgument = primaryArgument;
  if (targets[0]) request.primaryTarget = targets[0];
  if (input.projectId !== undefined) request.projectId = input.projectId;
  return request;
}

const exactReadPathTools = new Set<ToolName>(["read", "explain_image"]);
const exactWritePathTools = new Set<ToolName>(["edit", "write"]);
const treeReadPathTools = new Set<ToolName>(["grep", "find", "ls"]);

function extractTargets(
  toolName: ToolName,
  args: Record<string, unknown>,
  roots: PermissionRootPaths,
  cwd: string,
): PermissionTarget[] {
  if (exactReadPathTools.has(toolName)) {
    return stringPathTargets(args.path, "read", "exact", roots, cwd);
  }
  if (exactWritePathTools.has(toolName)) {
    return stringPathTargets(args.path, "write", "exact", roots, cwd);
  }
  if (treeReadPathTools.has(toolName)) {
    const values =
      toolName === "grep" && args.paths !== undefined
        ? args.paths
        : singletonSearchPath(args.path);
    return stringPathTargets(values, "read", "tree", roots, cwd);
  }
  if (toolName === "plan_mode_present") {
    return stringPathTargets(
      args.file_path,
      "read",
      "exact",
      roots,
      roots.plans,
    );
  }
  if (toolName === "web_fetch" && typeof args.url === "string") {
    return [
      {
        kind: "url",
        normalizedUrl: new URL(args.url).toString(),
        access: "read",
      },
    ];
  }
  if (toolName === "explore") return [{ kind: "agent", agentId: "explore" }];

  const fileArguments =
    toolName === "jira_manage_attachment" ||
    toolName === "confluence_manage_attachment"
      ? [args.file_path]
      : toolName === "confluence_create_page" ||
          toolName === "confluence_update_page"
        ? [args.page_file, args.body_file]
        : [];
  const fileTargets = fileArguments.flatMap((value) =>
    stringPathTargets(value, "read", "exact", roots, cwd),
  );
  if (fileTargets.length > 0) return fileTargets;
  return [{ kind: "whole_tool" }];
}

function singletonSearchPath(value: unknown): unknown {
  return value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
    ? "."
    : value;
}

function stringPathTargets(
  value: unknown,
  access: "read" | "write",
  scope: "exact" | "tree",
  roots: PermissionRootPaths,
  cwd: string,
): PermissionTarget[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry): PermissionTarget[] => {
    if (typeof entry !== "string" || entry.trim().length === 0) return [];
    const absolutePath = existingRealpath(resolve(cwd, entry));
    const rooted = symbolicPath(absolutePath, roots);
    return rooted
      ? [{ kind: "path" as const, access, scope, ...rooted }]
      : [{ kind: "path" as const, access, scope, absolutePath }];
  });
}

function symbolicPath(
  absolutePath: string,
  roots: PermissionRootPaths,
): { root: PathRoot; relativePath: string } | undefined {
  const candidates = (Object.entries(roots) as [PathRoot, string][])
    .map(([root, path]) => ({ root, path: existingRealpath(resolve(path)) }))
    .sort((left, right) => right.path.length - left.path.length);
  for (const candidate of candidates) {
    const child = relative(candidate.path, absolutePath);
    if (
      child === "" ||
      (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
    ) {
      return {
        root: candidate.root,
        relativePath: child.split(sep).join("/"),
      };
    }
  }
  return undefined;
}

function existingRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw error;
  }
}

export function evaluatePermissionRequest(
  input: EvaluatePermissionInput,
): PermissionEvaluationResult {
  const metadata = permissionMetadataForTool(input.request.toolName);
  const matching = input.policy.rules
    .filter(({ rule }) => rule.enabled && ruleMatches(rule, input.request))
    .filter(
      ({ rule }) =>
        rule.decision !== "allow" ||
        allowCoversRequest(rule, input.request, metadata.primaryTargetComplete),
    )
    .sort(compareEffectiveRules);
  const winner = matching[0];
  if (!winner) {
    throw new Error("Permission policy is not total for this request.");
  }
  return {
    decision: winner.rule.decision,
    reason: reasonForWinner(winner),
    baseRisk: metadata.baseRisk,
    normalizedTargets: input.request.targets,
    winningRuleId: winner.rule.id,
    winningRule: winner.rule,
    winningRuleOrigin: winner.origin,
    winningRuleEnforcement: winner.rule.enforcement,
    winningRulePrecedence: winner.precedence,
    activeRuleSetIds: [...input.policy.activeRuleSetIds],
    ignoredOverlays: [...input.policy.ignoredOverlays],
    policySnapshotHash: input.policy.snapshotHash,
    suggestedRules:
      winner.rule.decision === "prompt"
        ? suggestPermissionRules(input.request, metadata.baseRisk)
        : [],
  };
}

function compareEffectiveRules(
  left: EffectivePermissionRule,
  right: EffectivePermissionRule,
): number {
  return (
    right.precedence.enforcementRank - left.precedence.enforcementRank ||
    right.precedence.scopeRank - left.precedence.scopeRank ||
    right.precedence.priority - left.precedence.priority ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.rule.id.localeCompare(right.rule.id)
  );
}

function ruleMatches(
  rule: PermissionRule,
  request: NormalizedPermissionRequest,
): boolean {
  const filter = rule.when;
  const metadata = permissionMetadataForTool(request.toolName);
  return (
    includesIfPresent(filter.toolNames, request.toolName) &&
    includesIfPresent(filter.toolKinds, metadata.kind) &&
    (filter.toolGroups === undefined ||
      filter.toolGroups.some((group) => metadata.groups.includes(group))) &&
    includesIfPresent(filter.baseRisks, metadata.baseRisk) &&
    (filter.primaryArgument === undefined ||
      valueMatches(request.primaryArgument, filter.primaryArgument)) &&
    (filter.primaryTarget === undefined ||
      (request.primaryTarget !== undefined &&
        targetMatches(request.primaryTarget, filter.primaryTarget))) &&
    (filter.targets === undefined ||
      (filter.targets.quantifier === "any"
        ? request.targets.some((target) =>
            targetMatches(target, filter.targets!.matcher),
          )
        : request.targets.length > 0 &&
          request.targets.every((target) =>
            targetMatches(target, filter.targets!.matcher),
          ))) &&
    (filter.arguments === undefined ||
      filter.arguments.every((matcher) =>
        valueMatches(readArgumentPath(request.args, matcher.path), matcher),
      ))
  );
}

function includesIfPresent<T>(values: readonly T[] | undefined, value: T) {
  return values === undefined || values.includes(value);
}

function readArgumentPath(
  args: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = args;
  for (const segment of path.slice("args.".length).split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function valueMatches(value: unknown, matcher: ValueMatcher): boolean {
  if (matcher.operator === "exists")
    return (value !== undefined) === matcher.value;
  if (value === undefined) return false;
  if (matcher.operator === "equals") return deepEqual(value, matcher.value);
  if (matcher.operator === "not_equals")
    return !deepEqual(value, matcher.value);
  if (matcher.operator === "in") {
    return (
      isPrimitive(value) && matcher.value.some((item) => deepEqual(value, item))
    );
  }
  return (
    matcher.operator === "glob" &&
    typeof value === "string" &&
    patternMatches(value, matcher.value as string)
  );
}

function targetMatches(
  target: PermissionTarget,
  matcher: TargetMatcher,
): boolean {
  if (matcher.kind !== undefined && target.kind !== matcher.kind) return false;
  if (
    matcher.access !== undefined &&
    (!("access" in target) || target.access !== matcher.access)
  )
    return false;
  if (
    matcher.scope !== undefined &&
    (target.kind !== "path" || target.scope !== matcher.scope)
  )
    return false;
  if (
    matcher.root !== undefined &&
    (target.kind !== "path" ||
      !("root" in target) ||
      target.root !== matcher.root)
  )
    return false;
  if (matcher.pattern === undefined) return true;
  const value =
    target.kind === "path"
      ? "relativePath" in target
        ? target.relativePath
        : undefined
      : target.kind === "url"
        ? target.normalizedUrl
        : target.kind === "agent"
          ? target.agentId
          : "*";
  return value !== undefined && patternMatches(value, matcher.pattern);
}

function allowCoversRequest(
  rule: PermissionRule,
  request: NormalizedPermissionRequest,
  primaryTargetComplete: boolean,
): boolean {
  if (rule.when.targets?.quantifier === "all")
    return request.targets.length > 0;
  if (rule.when.primaryTarget !== undefined) return primaryTargetComplete;
  return true;
}

function reasonForWinner(winner: EffectivePermissionRule): string {
  const action =
    winner.rule.decision === "allow"
      ? "allows"
      : winner.rule.decision === "prompt"
        ? "requires approval for"
        : "denies";
  return winner.rule.description
    ? winner.rule.description
    : `Rule '${winner.rule.id}' from ${winner.origin} ${action} this request.`;
}

function suggestPermissionRules(
  request: NormalizedPermissionRequest,
  risk: StaticToolRisk,
): PermissionRule[] {
  const primary = comparable(request.primaryArgument);
  const onlyTarget =
    request.targets.length === 1 ? request.targets[0] : undefined;
  if (onlyTarget?.kind === "url") {
    const url = new URL(onlyTarget.normalizedUrl);
    if (url.username || url.password || url.search || url.hash) return [];
  }
  if (primary === undefined && (risk === "destructive" || risk === "secret"))
    return [];
  const when: PermissionRule["when"] = { toolNames: [request.toolName] };
  const target = onlyTarget;
  if (target?.kind === "path" && "root" in target) {
    when.targets = {
      quantifier: "all",
      matcher: {
        kind: "path",
        access: target.access,
        scope: target.scope,
        root: target.root,
        pattern: escapeGlobLiteral(target.relativePath),
      },
    };
  } else if (target?.kind === "url") {
    when.targets = {
      quantifier: "all",
      matcher: {
        kind: "url",
        access: target.access,
        pattern: escapeGlobLiteral(target.normalizedUrl),
      },
    };
  } else if (target?.kind === "agent") {
    when.targets = {
      quantifier: "all",
      matcher: {
        kind: "agent",
        pattern: escapeGlobLiteral(target.agentId),
      },
    };
  } else if (primary !== undefined) {
    when.primaryArgument = { operator: "equals", value: primary };
  }
  const digest = createHash("sha256")
    .update(canonicalJson({ toolName: request.toolName, when }))
    .digest("hex")
    .slice(0, 16);
  return [
    {
      id: `allow-${request.toolName}-${digest}`,
      description: `Allow the same ${request.toolName} request.`,
      enabled: true,
      priority: 0,
      enforcement: "overridable",
      when,
      decision: "allow",
    },
  ];
}

function comparable(value: unknown): ComparableValue | undefined {
  if (isPrimitive(value)) return value;
  if (Array.isArray(value) && value.every(isPrimitive)) {
    return value as PrimitiveValue[];
  }
  return undefined;
}

function isPrimitive(value: unknown): value is PrimitiveValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
