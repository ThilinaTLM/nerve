import type { BackgroundJobDefinition } from "../background-jobs/background-jobs.service.js";
import type { BackgroundJobNotices } from "../background-jobs/background-job-notices.js";
import type { AccountsService } from "./accounts.service.js";

export const CREDENTIAL_REFRESH_JOB_ID = "accounts.credential-refresh";
/** The Accounts page in Settings, where the user signs in again. */
const ACCOUNTS_SETTINGS_PAGE = "accounts";

/**
 * Keeps OAuth accounts signed in: every five minutes, refreshes the credentials that expire soon
 * and belong to accounts used recently, so a task does not meet an expired token. An account that
 * ends up needing sign-in gets a bell notice that names it; the notice goes away once the account
 * is ready again or deleted (`reconcile`, called when accounts change).
 */
export function createCredentialRefreshJob(deps: {
  accounts: Pick<AccountsService, "vault">;
  notices: Pick<BackgroundJobNotices, "report" | "clear">;
  /** Called for an account whose state the sweep changed, so open views reload it. */
  changed?: (account: { kind: string; accountId: string }) => void;
}): BackgroundJobDefinition {
  return {
    id: CREDENTIAL_REFRESH_JOB_ID,
    label: "Account credential refresh",
    description:
      "Refreshes account sign-ins that are about to expire, so they keep working in the background. Accounts not used for 30 days are left alone.",
    intervalMs: 5 * 60_000,
    timeoutMs: 2 * 60_000,
    run: async (signal) => {
      const sweep = await deps.accounts.vault.refreshDue({ signal });
      for (const problem of sweep.problems) {
        deps.changed?.({ kind: problem.kind, accountId: problem.id });
        deps.notices.report(CREDENTIAL_REFRESH_JOB_ID, problem.id, {
          title:
            problem.state === "needs_sign_in"
              ? `${problem.name} needs sign-in`
              : `${problem.name} stopped working`,
          message:
            problem.error ?? "Open Accounts in Settings to sign in again.",
          settingsPage: ACCOUNTS_SETTINGS_PAGE,
        });
      }
      const parts = [
        sweep.checked === 0
          ? "Nothing to refresh"
          : `Refreshed ${sweep.refreshed} of ${sweep.checked}`,
        ...(sweep.problems.length > 0
          ? [`${sweep.problems.length} need sign-in`]
          : []),
        ...(sweep.unreachable > 0
          ? [`${sweep.unreachable} unreachable, will retry`]
          : []),
      ];
      return `${parts.join("; ")}.`;
    },
  };
}

/** Clears an account's notice when it is ready again or gone; called when accounts change. */
export async function reconcileCredentialNotice(
  accounts: Pick<AccountsService, "view">,
  notices: Pick<BackgroundJobNotices, "clear">,
  account: { kind: string; accountId: string },
): Promise<void> {
  const view = await accounts.view(account.kind, account.accountId);
  if (!view || view.state === "ready")
    notices.clear(CREDENTIAL_REFRESH_JOB_ID, account.accountId);
}
