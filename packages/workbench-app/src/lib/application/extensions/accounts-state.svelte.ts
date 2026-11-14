import type { AccountHealth } from "@nervekit/contracts/auth";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type { AccountView } from "@nervekit/contracts/settings";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/**
 * The user's accounts and the kinds extensions define, with the latest
 * connection test of each account. Kept current by the accounts activity.
 */
class AccountsState {
  accounts = $state.raw<AccountView[]>([]);
  kinds = $state.raw<AccountKind[]>([]);
  health = $state.raw<AccountHealth[]>([]);
  loaded = $state(false);

  async load(): Promise<void> {
    const result = await requestWorkbench("accounts.list", {});
    this.accounts = result.accounts;
    this.kinds = result.kinds;
    this.loaded = true;
  }

  async loadHealth(): Promise<void> {
    this.health = (await requestWorkbench("accounts.health.list", {})).health;
  }

  healthOf(kind: string, id: string): AccountHealth | undefined {
    return this.health.find(
      (item) => item.kind === kind && item.accountId === id,
    );
  }

  /** Records the result of a test the user just ran. */
  setHealth(result: AccountHealth): void {
    this.health = [
      ...this.health.filter(
        (item) =>
          item.kind !== result.kind || item.accountId !== result.accountId,
      ),
      result,
    ];
  }
}

export const accountsState = new AccountsState();
