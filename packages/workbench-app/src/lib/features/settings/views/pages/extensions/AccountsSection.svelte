<!--
  The accounts of one kind: the list, the add and edit dialog, delete, and
  the connection test for kinds that define one. Generated from the kind.
-->
<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { AccountKind } from "@nervekit/contracts/extensions";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import type { Component } from "svelte";
import { onMount } from "svelte";
import type { AccountView } from "$lib/api";
import { deleteAccount, testAccount } from "$lib/api";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import {
  accountHealthBadge,
  accountHealthStale,
} from "$lib/presentation/integrations/account-health";
import { SettingsItem } from "$lib/presentation/settings";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import AccountDialog from "./AccountDialog.svelte";
import { accountCanTest } from "./account-form";

type Props = {
  kind: AccountKind;
  icon: Component<{ class?: string }>;
};
let { kind, icon }: Props = $props();

let dialogOpen = $state(false);
let editing = $state<AccountView | undefined>();
let pendingDelete = $state<AccountView | undefined>();
let checking = $state<Record<string, boolean>>({});
let checkErrors = $state<Record<string, string>>({});

const accounts = $derived(
  accountsState.accounts.filter((account) => account.kind === kind.kind),
);

async function test(account: AccountView): Promise<void> {
  if (checking[account.id]) return;
  checking[account.id] = true;
  delete checkErrors[account.id];
  try {
    accountsState.setHealth(
      await testAccount({ kind: kind.kind, id: account.id }),
    );
  } catch (cause) {
    checkErrors[account.id] =
      cause instanceof Error ? cause.message : "Could not test the connection.";
  } finally {
    checking[account.id] = false;
  }
}

onMount(() => {
  if (!kind.test) return;
  // Re-test stale results once per visit, one account at a time.
  void (async () => {
    await accountsState.loadHealth().catch(() => {});
    for (const account of accountsState.accounts) {
      if (
        account.kind === kind.kind &&
        accountCanTest(kind, account) &&
        accountHealthStale(accountsState.healthOf(kind.kind, account.id))
      )
        await test(account);
    }
  })();
});

export function openAdd(): void {
  editing = undefined;
  dialogOpen = true;
}
function openEdit(account: AccountView): void {
  editing = account;
  dialogOpen = true;
}
async function saved(account: AccountView): Promise<void> {
  await accountsState.load();
  if (accountCanTest(kind, account)) await test(account);
}
async function remove(): Promise<void> {
  const account = pendingDelete;
  if (!account) return;
  try {
    await deleteAccount({ kind: kind.kind, id: account.id });
    await accountsState.load();
  } finally {
    pendingDelete = undefined;
  }
}

/** The first filled field, e.g. the site URL. */
function summary(account: AccountView): string | undefined {
  for (const key of Object.keys(kind.fields)) {
    const value = account.fields[key];
    if (key !== "name" && typeof value === "string" && value) return value;
  }
  return undefined;
}
</script>

<SettingsEntityListSection
  sectionId="accounts"
  title={`${kind.label}s`}
  addLabel="Add account"
  emptyTitle={`No ${kind.label}s`}
  emptyDescription="Add an account for this extension to sign in with."
  items={accounts}
  listAriaLabel={`${kind.label}s`}
  itemKey={(account) => account.id}
  onAdd={openAdd}
>
  {#snippet row(account)}
    {@const testable = accountCanTest(kind, account)}
    {@const health = accountsState.healthOf(kind.kind, account.id)}
    {@const badge = accountHealthBadge(health)}
    {@const checkError = checkErrors[account.id]}
    {@const unhealthy =
      badge.tone === "destructive" || badge.tone === "warning"}
    <SettingsItem
      title={account.name}
      {icon}
      summary={[
        summary(account),
        kind.test && account.secretConfigured ? badge.label : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || `${kind.secret.label} stored`}
      problem={!account.secretConfigured
        ? `${kind.secret.label} missing`
        : checkError
          ? "Couldn’t test the connection"
          : testable && unhealthy
            ? badge.label
            : undefined}
      problemAction={!account.secretConfigured
        ? { label: "Add", onclick: () => openEdit(account) }
        : checkError || badge.tone === "warning"
          ? { label: "Retry", onclick: () => void test(account) }
          : { label: "Edit", onclick: () => openEdit(account) }}
      onOpen={() => openEdit(account)}
      openLabel={`Edit ${account.name}`}
    >
      {#snippet actions()}
        {#if testable}
          <IconAction
            icon={RefreshCw}
            label={checking[account.id]
              ? "Testing connection…"
              : "Test connection"}
            busy={checking[account.id]}
            onclick={() => void test(account)}
          />
        {/if}
        <IconAction
          icon={Trash2}
          label="Delete account"
          tone="destructive"
          onclick={() => (pendingDelete = account)}
        />
      {/snippet}
    </SettingsItem>
  {/snippet}
</SettingsEntityListSection>

<AccountDialog
  bind:open={dialogOpen}
  {kind}
  account={editing}
  onSaved={saved}
/>
<ConfirmDialog
  open={!!pendingDelete}
  title="Delete account?"
  description={pendingDelete
    ? `Delete “${pendingDelete.name}” and its stored ${kind.secret.label}? Extensions that use it need another account.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => void remove()}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
