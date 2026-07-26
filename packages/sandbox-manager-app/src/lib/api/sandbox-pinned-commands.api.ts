import { taskDefinitionSchema } from "@nervekit/contracts";
import type {
  CreatePinnedCommandRequest,
  SandboxPinnedCommand,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "./manager-protocol-client";

function legacyView(
  definition: ReturnType<typeof taskDefinitionSchema.parse>,
): SandboxPinnedCommand {
  return {
    id: definition.id as `pin_${string}`,
    sandboxId:
      definition.scope.kind === "sandbox" ? definition.scope.sandboxId : "",
    label: definition.label,
    command: definition.command,
    cwd: definition.cwd,
    runPolicy: definition.runPolicy,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

export async function listSandboxPinnedCommands(
  sandboxId: string,
): Promise<SandboxPinnedCommand[]> {
  const definitions = (
    await protocolRequest(
      "taskDefinition.list",
      { sandboxId },
      { target: { role: "sandbox_manager" } },
    )
  ).result.definitions;
  return definitions.map((definition) =>
    legacyView(taskDefinitionSchema.parse(definition)),
  );
}

export async function createSandboxPinnedCommand(
  sandboxId: string,
  request: CreatePinnedCommandRequest,
): Promise<SandboxPinnedCommand> {
  const definition = (
    await protocolRequest(
      "taskDefinition.create",
      {
        sandboxId,
        ...request,
        runPolicy: request.runPolicy ?? "single",
      },
      { target: { role: "sandbox_manager" } },
    )
  ).result.definition;
  return legacyView(taskDefinitionSchema.parse(definition));
}

export async function updateSandboxPinnedCommand(
  sandboxId: string,
  commandId: string,
  request: UpdatePinnedCommandRequest,
): Promise<SandboxPinnedCommand> {
  const definition = (
    await protocolRequest(
      "taskDefinition.update",
      {
        sandboxId,
        definitionId: commandId,
        ...request,
        runPolicy: request.runPolicy ?? "single",
      },
      { target: { role: "sandbox_manager" } },
    )
  ).result.definition;
  return legacyView(taskDefinitionSchema.parse(definition));
}

export async function deleteSandboxPinnedCommand(
  sandboxId: string,
  commandId: string,
): Promise<void> {
  await protocolRequest(
    "taskDefinition.delete",
    { sandboxId, definitionId: commandId },
    { target: { role: "sandbox_manager" } },
  );
}
