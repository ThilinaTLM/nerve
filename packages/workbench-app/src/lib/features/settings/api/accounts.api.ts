import type { AccountRef } from "@nervekit/contracts/auth";
import type { AccountView } from "@nervekit/contracts/settings";
import { protocolRequest } from "$lib/application/startup/workbench-connection";

const once = () => ({ idempotencyKey: crypto.randomUUID() });

/** Moves an account to a project, or to user level (`projectId` null), keeping its credential. */
export async function moveAccount(
  ref: AccountRef,
  projectId: string | null,
): Promise<AccountView> {
  return (await protocolRequest("accounts.move", { ...ref, projectId }, once()))
    .result.account;
}

/** Copies an account, with its credential, to a project or to user level. */
export async function duplicateAccount(
  ref: AccountRef,
  projectId: string | null,
): Promise<AccountView> {
  return (
    await protocolRequest("accounts.duplicate", { ...ref, projectId }, once())
  ).result.account;
}

/** Forgets the account's credential; the account itself stays. */
export async function clearAccountCredentials(
  ref: AccountRef,
): Promise<AccountView> {
  return (await protocolRequest("accounts.clearCredentials", ref, once()))
    .result.account;
}
