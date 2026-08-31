import { z } from "zod";
export type {
  OperationDefinition,
  OperationIdempotency,
  OperationKind,
} from "./definition.js";
import { agentsOperationDefinitions } from "../domains/agents/agent-operations.js";
import { runOperationDefinitions } from "../domains/agents/run-operations.js";
import { authOperationDefinitions } from "../domains/auth/operations.js";
import { completionsOperationDefinitions } from "../domains/completions/operations.js";
import { conversationsOperationDefinitions } from "../domains/conversations/operations.js";
import { filesystemOperationDefinitions } from "../domains/filesystem/operations.js";
import { gitOperationDefinitions } from "../domains/git/operations.js";
import { logsOperationDefinitions } from "../domains/logs/operations.js";
import { modelsOperationDefinitions } from "../domains/models/operations.js";
import { projectsOperationDefinitions } from "../domains/projects/operations.js";
import { promptSuggestionsOperationDefinitions } from "../domains/prompt-suggestions/operations.js";
import { providersOperationDefinitions } from "../domains/providers/operations.js";
import { scratchNotesOperationDefinitions } from "../domains/scratch-notes/operations.js";
import { settingsOperationDefinitions } from "../domains/settings/operations.js";
import { skillOperationDefinitions } from "../domains/skills/operations.js";
import { snapshotsOperationDefinitions } from "../domains/snapshots/operations.js";
import { statusOperationDefinitions } from "../domains/status/operations.js";
import { storageOperationDefinitions } from "../domains/storage/operations.js";
import { taskDefinitionOperationDefinitions } from "../domains/task-definitions/operations.js";
import { tasksOperationDefinitions } from "../domains/tasks/operations.js";
import { toolsOperationDefinitions } from "../domains/tools/operations.js";
import { usageOperationDefinitions } from "../domains/usage/operations.js";

const methodDefinitions = [
  ...agentsOperationDefinitions,
  ...runOperationDefinitions,
  ...authOperationDefinitions,
  ...completionsOperationDefinitions,
  ...conversationsOperationDefinitions,
  ...filesystemOperationDefinitions,
  ...gitOperationDefinitions,
  ...logsOperationDefinitions,
  ...modelsOperationDefinitions,
  ...projectsOperationDefinitions,
  ...promptSuggestionsOperationDefinitions,
  ...providersOperationDefinitions,
  ...scratchNotesOperationDefinitions,
  ...settingsOperationDefinitions,
  ...skillOperationDefinitions,
  ...snapshotsOperationDefinitions,
  ...statusOperationDefinitions,
  ...storageOperationDefinitions,
  ...taskDefinitionOperationDefinitions,
  ...tasksOperationDefinitions,
  ...toolsOperationDefinitions,
  ...usageOperationDefinitions,
] as const;

const methods = methodDefinitions.map((definition) => definition.method);
if (new Set(methods).size !== methods.length) {
  throw new Error("Duplicate operation method in the Protocol v1 catalog");
}

type CatalogOperationDefinition = (typeof methodDefinitions)[number];
export type OperationName = CatalogOperationDefinition["method"];
export type OperationDefinitionFor<M extends OperationName> = Extract<
  CatalogOperationDefinition,
  { readonly method: M }
>;
export type OperationParams<M extends OperationName> = z.input<
  OperationDefinitionFor<M>["paramsSchema"]
>;
export type OperationResult<M extends OperationName> = z.output<
  OperationDefinitionFor<M>["resultSchema"]
>;

export const operationNameSchema = z.enum(
  methods as [OperationName, ...OperationName[]],
);
export const operationKindSchema = z.enum([
  "read",
  "mutation",
  "accepted_async",
]);
export const operationIdempotencySchema = z.enum([
  "none",
  "recommended",
  "required",
]);

const definitionMap = new Map<OperationName, CatalogOperationDefinition>(
  methodDefinitions.map((definition) => [definition.method, definition]),
);

export function operationDefinition<M extends OperationName>(
  method: M,
): OperationDefinitionFor<M> {
  const definition = definitionMap.get(method);
  if (!definition) throw new Error(`Unknown operation: ${method}`);
  return definition as OperationDefinitionFor<M>;
}

export function operationParamsSchema<M extends OperationName>(
  method: M,
): OperationDefinitionFor<M>["paramsSchema"] {
  return operationDefinition(method)
    .paramsSchema as OperationDefinitionFor<M>["paramsSchema"];
}

export function operationResultSchema<M extends OperationName>(
  method: M,
): OperationDefinitionFor<M>["resultSchema"] {
  return operationDefinition(method)
    .resultSchema as OperationDefinitionFor<M>["resultSchema"];
}

export function parseOperationParams<M extends OperationName>(
  method: M,
  input: unknown,
): OperationParams<M> {
  return operationParamsSchema(method).parse(input) as OperationParams<M>;
}

export function parseOperationResult<M extends OperationName>(
  method: M,
  input: unknown,
): OperationResult<M> {
  return operationResultSchema(method).parse(input) as OperationResult<M>;
}

export function allOperationDefinitions(): readonly CatalogOperationDefinition[] {
  return methodDefinitions;
}
