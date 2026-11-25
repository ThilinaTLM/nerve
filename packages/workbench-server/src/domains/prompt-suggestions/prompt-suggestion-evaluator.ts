import vm from "node:vm";
import type {
  PromptSuggestion,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
} from "@nervekit/contracts/prompt-suggestions";
import type { TrustState } from "@nervekit/contracts/core";
import { suggestionStatusDetails } from "./prompt-suggestion-summary.js";
import {
  anyDirtyRepo,
  type PromptSuggestionDefinition,
  type PromptSuggestionDiagnostic,
  type PromptSuggestionEnableContext,
  type PromptSuggestionEvaluationInput,
} from "./prompt-suggestion-types.js";

const JS_TIMEOUT_MS = 50;

/** The trust state of a definition's `enable-js` predicate. */
export type PromptSuggestionTrustStates = (
  definition: PromptSuggestionDefinition,
) => TrustState;

export function evaluatePromptSuggestions(
  input: PromptSuggestionEvaluationInput,
  trust: PromptSuggestionTrustStates,
): {
  suggestions: PromptSuggestion[];
  trustRequests: PromptSuggestionTrustRequest[];
  statuses: PromptSuggestionStatus[];
  diagnostics: PromptSuggestionDiagnostic[];
} {
  const suggestions: PromptSuggestion[] = [];
  const trustRequests: PromptSuggestionTrustRequest[] = [];
  const statuses: PromptSuggestionStatus[] = [];
  const diagnostics: PromptSuggestionDiagnostic[] = [];
  const context = buildEnableContext(input);

  for (const definition of input.definitions) {
    if (!definition.enabled) {
      statuses.push(statusFor(definition, trust));
      continue;
    }
    if (
      !matchesWhen(definition, input) ||
      (definition.matches !== undefined && !definition.matches(input))
    ) {
      statuses.push(statusFor(definition, trust));
      continue;
    }

    if (definition.enableJs) {
      if (!definition.trustId || !definition.predicateHash) continue;
      const state = trust(definition);
      if (state === "needs_review") {
        trustRequests.push({
          trustId: definition.trustId,
          name: definition.name,
          label: definition.label,
          description: definition.description,
          path: definition.source.path,
          sourceKind: definition.source.kind,
          projectId: definition.source.projectId,
          predicateHash: definition.predicateHash,
        });
        statuses.push(statusFor(definition, trust));
        continue;
      }
      if (state === "declined") {
        statuses.push(statusFor(definition, trust));
        continue;
      }
      const enabled = evaluateEnableJs(definition, context, diagnostics);
      statuses.push(statusFor(definition, trust));
      if (!enabled) continue;
    } else {
      statuses.push(statusFor(definition, trust));
    }

    suggestions.push({
      id: definition.id,
      name: definition.name,
      label: definition.buildLabel?.(input) ?? definition.label,
      description: definition.description,
      prompt: definition.buildPrompt?.(input) ?? definition.prompt,
      context: definition.buildContext?.(input),
      order: definition.order,
      source: definition.source,
      requiresTrust: Boolean(definition.enableJs),
      trustStatus: definition.enableJs ? "trusted" : "not_required",
    });
  }

  return { suggestions, trustRequests, statuses, diagnostics };
}

export function buildEnableContext(
  input: PromptSuggestionEvaluationInput,
): PromptSuggestionEnableContext {
  return deepFreeze({
    timestamp: new Date().toISOString(),
    platform: process.platform,
    project: {
      id: input.project.id,
      name: input.project.name,
      dir: input.project.dir,
    },
    git: structuredClone(input.git),
    conversation: input.conversation ? { ...input.conversation } : undefined,
  });
}

function matchesWhen(
  definition: PromptSuggestionDefinition,
  input: PromptSuggestionEvaluationInput,
): boolean {
  const when = definition.when;
  if (!when) return true;
  if (
    when.gitDirty !== undefined &&
    anyDirtyRepo(input.git.repos) !== when.gitDirty
  ) {
    return false;
  }
  if (
    when.hasRepos !== undefined &&
    input.git.repos.length > 0 !== when.hasRepos
  ) {
    return false;
  }
  if (
    when.githubAuthenticated !== undefined &&
    Boolean(input.git.github?.available && input.git.github?.authenticated) !==
      when.githubAuthenticated
  ) {
    return false;
  }
  const repos = input.git.repos;
  if (
    when.gitAhead !== undefined &&
    repos.some((repo) => (repo.ahead ?? 0) > 0) !== when.gitAhead
  ) {
    return false;
  }
  if (
    when.gitBehind !== undefined &&
    repos.some((repo) => (repo.behind ?? 0) > 0) !== when.gitBehind
  ) {
    return false;
  }
  if (
    when.onBaseBranch !== undefined &&
    repos.some((repo) => repo.onBaseBranch) !== when.onBaseBranch
  ) {
    return false;
  }
  if (
    when.hasPullRequest !== undefined &&
    repos.some((repo) => Boolean(repo.pullRequest)) !== when.hasPullRequest
  ) {
    return false;
  }
  const permissionRuleSetId = input.conversation?.permissionRuleSetId;
  if (
    when.permissionRuleSets &&
    (!permissionRuleSetId ||
      !when.permissionRuleSets.includes(permissionRuleSetId))
  ) {
    return false;
  }
  return true;
}

function evaluateEnableJs(
  definition: PromptSuggestionDefinition,
  context: PromptSuggestionEnableContext,
  diagnostics: PromptSuggestionDiagnostic[],
): boolean {
  try {
    const sandbox = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    });
    Object.defineProperty(sandbox, "context", {
      value: context,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    const script = new vm.Script(
      `"use strict";\n${definition.enableJs}\n; enable(context);`,
      { filename: definition.source.path },
    );
    const result = script.runInContext(sandbox, { timeout: JS_TIMEOUT_MS });
    return result === true;
  } catch (error) {
    diagnostics.push({
      level: "warning",
      code: "enable-failed",
      message: `enable predicate failed for ${definition.name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path: definition.source.path,
    });
    return false;
  }
}

function statusFor(
  definition: PromptSuggestionDefinition,
  trust: PromptSuggestionTrustStates,
): PromptSuggestionStatus {
  return {
    trustId: definition.trustId,
    definitionKey: definition.definitionKey,
    name: definition.name,
    label: definition.label,
    description: definition.description,
    path: definition.source.path,
    sourceKind: definition.source.kind,
    projectId: definition.source.projectId,
    requiresTrust: Boolean(definition.enableJs),
    status: definition.enableJs ? trust(definition) : "not_required",
    enabled: definition.enabled,
    defaultEnabled: definition.defaultEnabled,
    predicateHash: definition.predicateHash,
    ...suggestionStatusDetails(definition),
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
