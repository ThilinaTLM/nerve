import { z } from "zod";
import type { OperationDefinition } from "./operation-definition.schema.js";
export type {
  OperationDefinition,
  OperationIdempotency,
  OperationKind,
} from "./operation-definition.schema.js";
import { agentsOperationDefinitions } from "../agents/agent.operations.schema.js";
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
import { settingsOperationDefinitions } from "../settings/settings.operations.schema.js";
import { snapshotsOperationDefinitions } from "../snapshots/snapshot.operations.schema.js";
import { storageOperationDefinitions } from "../storage/storage.operations.schema.js";
import { tasksOperationDefinitions } from "../tasks/task.operations.schema.js";
import { toolsOperationDefinitions } from "../tools/tool.operations.schema.js";
import { usageOperationDefinitions } from "../usage/usage.operations.schema.js";
import { workersOperationDefinitions } from "../workers/worker.operations.schema.js";

const methodDefinitions = [
  ...agentsOperationDefinitions,
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

export type OperationName = (typeof methodDefinitions)[number]["method"];
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

const definitionMap = new Map<
  OperationName,
  OperationDefinition<OperationName>
>(methodDefinitions.map((definition) => [definition.method, definition]));

export function operationDefinition(
  method: OperationName,
): OperationDefinition<OperationName> {
  const definition = definitionMap.get(method);
  if (!definition) throw new Error(`Unknown operation: ${method}`);
  return definition;
}

export function operationParamsSchema(method: OperationName): z.ZodType {
  return operationDefinition(method).paramsSchema;
}

export function operationResultSchema(method: OperationName): z.ZodType {
  return operationDefinition(method).resultSchema;
}

export function allOperationDefinitions(): OperationDefinition<OperationName>[] {
  return [...methodDefinitions];
}
