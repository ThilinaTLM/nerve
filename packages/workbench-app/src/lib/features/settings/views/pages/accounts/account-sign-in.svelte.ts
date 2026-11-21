import type { AccountKind } from "@nervekit/contracts/extensions";
import type { AccountView } from "@nervekit/contracts/settings";
import { startAccountSignIn } from "$lib/api";
import { OAuthFlowSession } from "$lib/application/auth/oauth-flow-session.svelte";
import type { AccountSignIn } from "./accounts-view";

/** Signs one account in through the server's sign-in flow; the dialog shows its prompts. */
export class AccountSignInFlow extends OAuthFlowSession {
  open = $state(false);
  account = $state<AccountView | undefined>(undefined);

  async start(account: AccountView): Promise<void> {
    this.account = account;
    this.open = true;
    await this.begin(() =>
      startAccountSignIn({ kind: account.kind, id: account.id }),
    );
  }

  /** Closing cancels a flow that still waits for the user. */
  async close(): Promise<void> {
    this.open = false;
    await this.endSession();
    this.resetSession();
    this.account = undefined;
  }

  async dispose(): Promise<void> {
    await this.endSession();
  }

  /** The hook the Accounts page takes: kinds with a provider (OAuth, or the extension's own code) sign in here. */
  readonly signIn: AccountSignIn = {
    supports: (kind: AccountKind) => kind.provider !== undefined,
    start: (account) => this.start(account),
  };
}
