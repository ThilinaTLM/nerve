import vm from "node:vm";
import type {
  PromptSuggestion,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
} from "@nervekit/shared";
import type { PromptSuggestionTrustRecord } from "./prompt-suggestion-trust.repository.js";
import {
  activeMode,
  activePermissionLevel,
  anyDirtyRepo,
  type PromptSuggestionDefinition,
  type PromptSuggestionDiagnostic,
  type PromptSuggestionEnableContext,
  type PromptSuggestionEvaluationInput,
} from "./prompt-suggestion-types.js";

const JS_TIMEOUT_MS = 50;

export function evaluatePromptSuggestions(
  input: PromptSuggestionEvaluationInput,
  trustRecords: PromptSuggestionTrustRecord[],
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
  const trustById = new Map(
    trustRecords.map((record) => [record.trustId, record]),
  );

  for (const definition of input.definitions) {
    if (!definition.enabled) continue;
    if (!matchesWhen(definition, input)) {
      statuses.push(
        statusFor(definition, trustById.get(definition.trustId ?? "")),
      );
      continue;
    }

    const trustRecord = definition.trustId
      ? trustById.get(definition.trustId)
      : undefined;
    if (definition.enableJs) {
      if (!definition.trustId || !definition.predicateHash) continue;
      if (!trustRecord) {
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
        statuses.push(statusFor(definition));
        continue;
      }
      if (trustRecord.status === "denied") {
        statuses.push(statusFor(definition, trustRecord));
        continue;
      }
      const enabled = evaluateEnableJs(definition, context, diagnostics);
      statuses.push(statusFor(definition, trustRecord));
      if (!enabled) continue;
    } else {
      statuses.push(statusFor(definition));
    }

    suggestions.push({
      id: definition.id,
      name: definition.name,
      label: definition.label,
      description: definition.description,
      prompt: definition.prompt,
      order: definition.order,
      source: definition.source,
      requiresTrust: Boolean(definition.enableJs),
      trustStatus: definition.enableJs ? "allowed" : "not_required",
    });
  }

  return { suggestions, trustRequests, statuses, diagnostics };
}

export function buildEnableContext(
  input: PromptSuggestionEvaluationInput,
): PromptSuggestionEnableContext {
  return deepFreeze({
    now: new Date().toISOString(),
    platform: process.platform,
    project: {
      id: input.project.id,
      name: input.project.name,
      dir: input.project.dir,
    },
    git: input.git,
    conversation: input.conversation
      ? {
          id: input.conversation.id,
          title: input.conversation.title,
          mode: input.conversation.mode,
          permissionLevel: input.conversation.permissionLevel,
        }
      : undefined,
    agent: input.agent
      ? {
          id: input.agent.id,
          mode: input.agent.mode,
          permissionLevel: input.agent.permissionLevel,
          status: input.agent.status,
          thinkingLevel: input.agent.thinkingLevel,
        }
      : undefined,
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
  const mode = activeMode(input);
  if (when.modes && (!mode || !when.modes.includes(mode))) return false;
  const permissionLevel = activePermissionLevel(input);
  if (
    when.permissionLevels &&
    (!permissionLevel || !when.permissionLevels.includes(permissionLevel))
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
      type: "warning",
      code: "enable_failed",
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
  trustRecord?: PromptSuggestionTrustRecord,
): PromptSuggestionStatus {
  return {
    trustId: definition.trustId,
    name: definition.name,
    label: definition.label,
    description: definition.description,
    path: definition.source.path,
    sourceKind: definition.source.kind,
    projectId: definition.source.projectId,
    requiresTrust: Boolean(definition.enableJs),
    status: definition.enableJs
      ? (trustRecord?.status ?? "unset")
      : "not_required",
    predicateHash: definition.predicateHash,
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
