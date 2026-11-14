import { untrack } from "svelte";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import { refreshSelectedAccounts } from "$lib/application/extensions/selected-accounts.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";

/** Keeps the user's accounts, their health, and the accounts extensions select current. */
export function createAccountsActivity(): void {
  $effect(() => {
    if (!workbenchStartupState.progressiveActive) return;
    const quietly = (load: () => Promise<void>) => () =>
      void load().catch(() => {});
    const refreshAccounts = quietly(() => accountsState.load());
    const refreshHealth = quietly(() => accountsState.loadHealth());
    const refreshSelected = quietly(refreshSelectedAccounts);
    untrack(() => {
      refreshAccounts();
      refreshHealth();
      refreshSelected();
    });
    const stop = [
      onEvent("accounts.changed", () => {
        refreshAccounts();
        refreshSelected();
      }),
      onEvent("accounts.health_changed", refreshHealth),
      // Selections can be changed or cleared in settings.
      onEvent("settings.updated", refreshSelected),
    ];
    return () => stop.forEach((off) => off());
  });
}
