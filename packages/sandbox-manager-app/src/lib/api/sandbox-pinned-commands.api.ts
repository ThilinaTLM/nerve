import type {
  CreatePinnedCommandRequest,
  SandboxPinnedCommand,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "./manager-protocol-client";

export async function listSandboxPinnedCommands(
  sandboxId: string,
): Promise<SandboxPinnedCommand[]> {
  return (
    await protocolRequest<{ commands: SandboxPinnedCommand[] }>(
      "sandbox.pinnedCommand.list",
      { sandboxId },
    )
  ).result.commands;
}

export async function createSandboxPinnedCommand(
  sandboxId: string,
  request: CreatePinnedCommandRequest,
): Promise<SandboxPinnedCommand> {
  return (
    await protocolRequest<{ command: SandboxPinnedCommand }>(
      "sandbox.pinnedCommand.create",
      { sandboxId, ...request },
      { idempotencyKey: `sandbox-pin-create-${sandboxId}-${Date.now()}` },
    )
  ).result.command;
}

export async function updateSandboxPinnedCommand(
  sandboxId: string,
  commandId: string,
  request: UpdatePinnedCommandRequest,
): Promise<SandboxPinnedCommand> {
  return (
    await protocolRequest<{ command: SandboxPinnedCommand }>(
      "sandbox.pinnedCommand.update",
      { sandboxId, commandId, ...request },
      {
        idempotencyKey: `sandbox-pin-update-${sandboxId}-${commandId}-${Date.now()}`,
      },
    )
  ).result.command;
}

export async function deleteSandboxPinnedCommand(
  sandboxId: string,
  commandId: string,
): Promise<void> {
  await protocolRequest<{ ok: true }>(
    "sandbox.pinnedCommand.delete",
    { sandboxId, commandId },
    {
      idempotencyKey: `sandbox-pin-delete-${sandboxId}-${commandId}-${Date.now()}`,
    },
  );
}
