import { sandboxPinnedCommandSchema } from "@nervekit/contracts";
import type {
  CreatePinnedCommandRequest,
  SandboxPinnedCommand,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "./manager-protocol-client";

export async function listSandboxPinnedCommands(
  sandboxId: string,
): Promise<SandboxPinnedCommand[]> {
  const commands = (
    await protocolRequest(
      "pinnedCommand.list",
      { sandboxId },
      { target: { role: "sandbox_manager" } },
    )
  ).result.commands;
  return commands.map((command) => sandboxPinnedCommandSchema.parse(command));
}

export async function createSandboxPinnedCommand(
  sandboxId: string,
  request: CreatePinnedCommandRequest,
): Promise<SandboxPinnedCommand> {
  const command = (
    await protocolRequest(
      "pinnedCommand.create",
      { sandboxId, ...request },
      {
        idempotencyKey: `sandbox-pin-create-${sandboxId}-${Date.now()}`,
        target: { role: "sandbox_manager" },
      },
    )
  ).result.command;
  return sandboxPinnedCommandSchema.parse(command);
}

export async function updateSandboxPinnedCommand(
  sandboxId: string,
  commandId: string,
  request: UpdatePinnedCommandRequest,
): Promise<SandboxPinnedCommand> {
  const command = (
    await protocolRequest(
      "pinnedCommand.update",
      { sandboxId, commandId, ...request },
      {
        idempotencyKey: `sandbox-pin-update-${sandboxId}-${commandId}-${Date.now()}`,
        target: { role: "sandbox_manager" },
      },
    )
  ).result.command;
  return sandboxPinnedCommandSchema.parse(command);
}

export async function deleteSandboxPinnedCommand(
  sandboxId: string,
  commandId: string,
): Promise<void> {
  await protocolRequest(
    "pinnedCommand.delete",
    { sandboxId, commandId },
    {
      idempotencyKey: `sandbox-pin-delete-${sandboxId}-${commandId}-${Date.now()}`,
      target: { role: "sandbox_manager" },
    },
  );
}
