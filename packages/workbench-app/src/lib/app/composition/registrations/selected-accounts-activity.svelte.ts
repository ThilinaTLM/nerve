import { untrack } from "svelte";
import { refreshSelectedAccounts } from "$lib/application/extensions/selected-accounts.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";

/** Keeps the accounts the user's extensions select current for guides and tool links. */
export function createSelectedAccountsActivity(): void {
  $effect(() => {
    if (!workbenchStartupState.progressiveActive) return;
    const refresh = () => void refreshSelectedAccounts().catch(() => {});
    untrack(refresh);
    // Accounts can be deleted or replaced in settings.
    return onEvent("settings.updated", refresh);
  });
}
