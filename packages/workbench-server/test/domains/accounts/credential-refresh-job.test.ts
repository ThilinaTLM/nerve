import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREDENTIAL_REFRESH_JOB_ID,
  createCredentialRefreshJob,
  reconcileCredentialNotice,
} from "../../../src/domains/accounts/credential-refresh-job.js";
import type { RefreshSweep } from "../../../src/domains/accounts/credential-vault.js";

function setup(sweep: RefreshSweep) {
  const reported: { job: string; key: string; notice: unknown }[] = [];
  const cleared: string[] = [];
  const notices = {
    report: (job: string, key: string, notice: unknown) =>
      void reported.push({ job, key, notice }),
    clear: (job: string, key: string) => void cleared.push(`${job}:${key}`),
  };
  const signals: AbortSignal[] = [];
  const job = createCredentialRefreshJob({
    accounts: {
      vault: {
        refreshDue: async (options: { signal?: AbortSignal }) => {
          if (options.signal) signals.push(options.signal);
          return sweep;
        },
      } as never,
    },
    notices,
  });
  return { job, reported, cleared, signals, notices };
}

describe("account credential refresh job", () => {
  it("is a five-minute sweep with a bounded run", () => {
    const { job } = setup({
      checked: 0,
      refreshed: 0,
      skipped: 0,
      unreachable: 0,
      problems: [],
    });
    assert.equal(job.id, "accounts.credential-refresh");
    assert.equal(job.intervalMs, 5 * 60_000);
    assert.ok(job.timeoutMs > 0 && job.timeoutMs < job.intervalMs);
  });

  it("summarizes the sweep and reports the accounts that need sign-in, linking the Accounts page", async () => {
    const { job, reported, signals } = setup({
      checked: 3,
      refreshed: 1,
      skipped: 0,
      unreachable: 0,
      problems: [
        {
          id: "a1",
          kind: "svc",
          name: "Work",
          state: "needs_sign_in",
          error: "Revoked.",
        },
        { id: "a2", kind: "svc", name: "Home", state: "failed" },
      ],
    });
    const controller = new AbortController();
    const summary = await job.run(controller.signal);
    assert.equal(summary, "Refreshed 1 of 3; 2 need sign-in.");
    assert.equal(signals[0], controller.signal);
    assert.deepEqual(
      reported.map((r) => [
        r.job,
        r.key,
        (r.notice as { title: string; settingsPage: string }).title,
        (r.notice as { settingsPage: string }).settingsPage,
      ]),
      [
        [CREDENTIAL_REFRESH_JOB_ID, "a1", "Work needs sign-in", "accounts"],
        [CREDENTIAL_REFRESH_JOB_ID, "a2", "Home stopped working", "accounts"],
      ],
    );
    assert.doesNotMatch(JSON.stringify(reported), /token|secret/i);
  });

  it("says when there was nothing to do", async () => {
    const { job } = setup({
      checked: 0,
      refreshed: 0,
      skipped: 0,
      unreachable: 0,
      problems: [],
    });
    assert.equal(
      await job.run(new AbortController().signal),
      "Nothing to refresh.",
    );
    const retry = setup({
      checked: 1,
      refreshed: 0,
      skipped: 0,
      unreachable: 1,
      problems: [],
    });
    assert.equal(
      await retry.job.run(new AbortController().signal),
      "Refreshed 0 of 1; 1 unreachable, will retry.",
    );
  });

  it("clears an account's notice once it is ready again or deleted", async () => {
    const { notices, cleared } = setup({
      checked: 0,
      refreshed: 0,
      skipped: 0,
      unreachable: 0,
      problems: [],
    });
    const states: Record<string, string> = {
      ready: "ready",
      broken: "needs_sign_in",
    };
    const accounts = {
      view: async (_kind: string, id: string) =>
        id in states ? ({ state: states[id] } as never) : undefined,
    };
    for (const id of ["ready", "broken", "deleted"])
      await reconcileCredentialNotice(accounts, notices, {
        kind: "svc",
        accountId: id,
      });
    assert.deepEqual(cleared, [
      `${CREDENTIAL_REFRESH_JOB_ID}:ready`,
      `${CREDENTIAL_REFRESH_JOB_ID}:deleted`,
    ]);
  });
});
