<!--
  The accounts of one kind: the list, the add and edit dialog, delete, and
  the connection test for kinds that define one. Generated from the kind.
  With `choice`, the list is also the extension's account setting (the Account
  section): a radio in each row chooses, the section takes the field's title,
  description, change indicator and lock. `readonly` (project scope) keeps the
  choice but drops add, edit, test and delete for "Manage in user settings".
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
  AccountKind,
  ExtensionIcon,
} from "@nervekit/contracts/extensions";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { onMount } from "svelte";
import type { AccountView } from "$lib/api";
import { deleteAccount, testAccount } from "$lib/api";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import AccountHealthIcon from "$lib/presentation/integrations/AccountHealthIcon.svelte";
import {
  accountHealthBadge,
  accountHealthStale,
} from "$lib/presentation/integrations/account-health";
import {
  SettingsChangeIndicator,
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";
import AccountDialog from "./AccountDialog.svelte";
import ExtensionMark from "./ExtensionMark.svelte";
import { accountCanTest } from "./account-form";
import type { ExtensionChange, ExtensionsScope } from "./extensions-view";

type Props = {
  kind: AccountKind;
  /** The owning extension's mark. */
  icon: ExtensionIcon;
  /** Project scope: accounts are managed in user settings. */
  readonly?: boolean;
  /** Opens user settings' accounts; the readonly section's action. */
  onManage?: () => void;
  /** The account field this list stands for, when merged with it. */
  choice?: {
    title: string;
    description?: string;
    scope: ExtensionsScope;
    /** The chosen account id. */
    value?: string;
    /** The field cannot be changed (busy, read-only or locked). */
    disabled: boolean;
    /** Why, when it is fixed; shown as a lock. */
    lockedReason?: string;
    change?: ExtensionChange;
    onSelect: (id: string) => void;
    onReset: () => void;
  };
};
let { kind, icon, readonly = false, onManage, choice }: Props = $props();

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
    if (readonly) return;
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

<SettingsSection
  id="accounts"
  title={choice?.title ?? `${kind.label}s`}
  description={choice?.description}
>
  {#snippet actions()}
    {#if choice?.lockedReason}
      <span class="inline-flex" title={choice.lockedReason}>
        <Lock
          class="size-3.5 text-muted-foreground"
          aria-label={choice.lockedReason}
        />
      </span>
    {/if}
    {#if choice?.change}
      <SettingsChangeIndicator
        scope={choice.scope}
        from={choice.change.from}
        onReset={choice.onReset}
      />
    {/if}
    {#if readonly}
      <Button variant="outline" size="sm" onclick={onManage}
        >Manage in user settings</Button
      >
    {:else}
      <Button variant="outline" size="sm" onclick={openAdd}>Add account</Button>
    {/if}
  {/snippet}

  {#if accounts.length === 0}
    <SettingsEmptyState
      variant="card"
      title={`No ${kind.label}s`}
      description={readonly
        ? "Accounts are added in user settings."
        : "Add an account for this extension to sign in with."}
    />
  {:else if choice}
    <RadioGroup.Root
      value={choice.value ?? ""}
      disabled={choice.disabled}
      onValueChange={choice.onSelect}
      aria-label={choice.title}
    >
      <SettingsList ariaLabel={`${kind.label}s`}>
        {#each accounts as account (account.id)}
          {@render accountRow(account)}
        {/each}
      </SettingsList>
    </RadioGroup.Root>
  {:else}
    <SettingsList ariaLabel={`${kind.label}s`}>
      {#each accounts as account (account.id)}
        {@render accountRow(account)}
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

{#snippet accountRow(account: AccountView)}
  {#snippet mark()}
    <ExtensionMark {icon} />
  {/snippet}
  {#snippet radio()}
    <RadioGroup.Item
      value={account.id}
      aria-label={`Use ${account.name}`}
      disabled={choice?.disabled}
    />
  {/snippet}
  {#snippet rowActions()}
    {#if accountCanTest(kind, account)}
      <IconAction
        icon={RefreshCw}
        label={checking[account.id] ? "Testing connection…" : "Test connection"}
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
  {@const testable = accountCanTest(kind, account)}
  {@const health = accountsState.healthOf(kind.kind, account.id)}
  {@const badge = accountHealthBadge(health)}
  {@const checkError = checkErrors[account.id]}
  {@const unhealthy = badge.tone === "destructive" || badge.tone === "warning"}
  <SettingsItem
    title={account.name}
    summary={summary(account) ?? `${kind.secret.label} stored`}
    problem={!account.secretConfigured
      ? `${kind.secret.label} missing`
      : checkError
        ? "Couldn’t test the connection"
        : testable && unhealthy
          ? badge.label
          : undefined}
    problemAction={readonly
      ? undefined
      : !account.secretConfigured
        ? { label: "Add", onclick: () => openEdit(account) }
        : checkError || badge.tone === "warning"
          ? { label: "Retry", onclick: () => void test(account) }
          : { label: "Edit", onclick: () => openEdit(account) }}
    onOpen={readonly ? undefined : () => openEdit(account)}
    openLabel={`Edit ${account.name}`}
    select={choice ? radio : undefined}
    leading={choice ? undefined : mark}
    actions={readonly ? undefined : rowActions}
  >
    {#snippet badges()}
      {#if kind.test && account.secretConfigured}
        <AccountHealthIcon {health} />
      {/if}
    {/snippet}
  </SettingsItem>
{/snippet}

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
