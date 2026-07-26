import {
  taskDefinitionSchema,
  type CreateTaskDefinitionRequest,
  type TaskDefinition,
  type UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "./manager-protocol-client";

export async function listSandboxTaskDefinitions(
  sandboxId: string,
): Promise<TaskDefinition[]> {
  const definitions = (
    await protocolRequest(
      "taskDefinition.list",
      { sandboxId },
      { target: { role: "sandbox_manager" } },
    )
  ).result.definitions;
  return definitions.map((definition) =>
    taskDefinitionSchema.parse(definition),
  );
}

export async function createSandboxTaskDefinition(
  sandboxId: string,
  request: CreateTaskDefinitionRequest,
): Promise<TaskDefinition> {
  const definition = (
    await protocolRequest(
      "taskDefinition.create",
      { sandboxId, ...request },
      { target: { role: "sandbox_manager" } },
    )
  ).result.definition;
  return taskDefinitionSchema.parse(definition);
}

export async function updateSandboxTaskDefinition(
  sandboxId: string,
  definitionId: string,
  request: UpdateTaskDefinitionRequest,
): Promise<TaskDefinition> {
  const definition = (
    await protocolRequest(
      "taskDefinition.update",
      { sandboxId, definitionId, ...request },
      { target: { role: "sandbox_manager" } },
    )
  ).result.definition;
  return taskDefinitionSchema.parse(definition);
}

export async function deleteSandboxTaskDefinition(
  sandboxId: string,
  definitionId: string,
): Promise<void> {
  await protocolRequest(
    "taskDefinition.delete",
    { sandboxId, definitionId },
    { target: { role: "sandbox_manager" } },
  );
}
