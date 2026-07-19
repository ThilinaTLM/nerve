import { z } from "zod";
export type {
  OperationDefinition,
  OperationIdempotency,
  OperationKind,
} from "./operation-definition.schema.js";
import { agentsOperationDefinitions } from "../agents/agent.operations.schema.js";
import { runOperationDefinitions } from "../agents/run.operations.schema.js";
import { authOperationDefinitions } from "../auth/auth.operations.schema.js";
import { completionsOperationDefinitions } from "../completions/completion.operations.schema.js";
import { conversationsOperationDefinitions } from "../conversations/conversation.operations.schema.js";
import { filesystemOperationDefinitions } from "../filesystem/filesystem.operations.schema.js";
import { gitOperationDefinitions } from "../git/git.operations.schema.js";
import { logsOperationDefinitions } from "../logs/logs.operations.schema.js";
import { modelsOperationDefinitions } from "../models/model.operations.schema.js";
import { pinnedCommandsOperationDefinitions } from "../pinned-commands/pinned-command.operations.schema.js";
import { projectsOperationDefinitions } from "../projects/project.operations.schema.js";
import { promptSuggestionsOperationDefinitions } from "../prompt-suggestions/prompt-suggestion.operations.schema.js";
import { providersOperationDefinitions } from "../providers/provider.operations.schema.js";
import { sandboxOperationDefinitions } from "../sandbox/sandbox.operations.schema.js";
import { scratchNotesOperationDefinitions } from "../scratch-notes/scratch-note.operations.schema.js";
import { settingsOperationDefinitions } from "../settings/settings.operations.schema.js";
import { snapshotsOperationDefinitions } from "../snapshots/snapshot.operations.schema.js";
import { storageOperationDefinitions } from "../storage/storage.operations.schema.js";
import { tasksOperationDefinitions } from "../tasks/task.operations.schema.js";
import { toolsOperationDefinitions } from "../tools/tool.operations.schema.js";
import { usageOperationDefinitions } from "../usage/usage.operations.schema.js";
import { workersOperationDefinitions } from "../workers/worker.operations.schema.js";

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
  ...pinnedCommandsOperationDefinitions,
  ...projectsOperationDefinitions,
  ...promptSuggestionsOperationDefinitions,
  ...providersOperationDefinitions,
  ...sandboxOperationDefinitions,
  ...scratchNotesOperationDefinitions,
  ...settingsOperationDefinitions,
  ...snapshotsOperationDefinitions,
  ...storageOperationDefinitions,
  ...tasksOperationDefinitions,
  ...toolsOperationDefinitions,
  ...usageOperationDefinitions,
  ...workersOperationDefinitions,
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
