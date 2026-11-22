<!--
  The account setting of an extension: the accounts of one kind with a radio in
  each row that chooses one. The section takes the field's title, description,
  change indicator and lock. Accounts are added here (the Accounts page is only
  an index); a row opens to edit, and signs in or retries from its problem line.
  A user-scope setting offers user-level accounts; a project setting also offers
  that project's. With a project open (`choice.layers`) each row has two radio
  slots, User and the project: the project follows User until it picks another
  account, and picking User's account again clears the override. Project
  accounts have no User radio.
-->
<script lang="ts">
import KeyRound from "@lucide/svelte/icons/key-round";
import Lock from "@lucide/svelte/icons/lock";
import Plus from "@lucide/svelte/icons/plus";
import type {
  AccountKind,
  ExtensionIcon,
} from "@nervekit/contracts/extensions";
import { ColumnLabels } from "$lib/presentation/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import type { AccountView } from "$lib/api";
import { testAccount } from "$lib/api";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import {
  SettingsChangeIndicator,
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import AccountSignInDialog from "../accounts/AccountSignInDialog.svelte";
import { AccountSignInFlow } from "../accounts/account-sign-in.svelte";
import { accountSummary, visibleAccounts } from "../accounts/accounts-view";
import AccountDialog from "./AccountDialog.svelte";
import ExtensionMark from "./ExtensionMark.svelte";
import type { ExtensionChange, ExtensionsScope } from "./extensions-view";

type Props = {
  kind: AccountKind;
  /** The owning extension's mark. */
  icon: ExtensionIcon;
  /** The project of a project-scope setting. */
  projectId?: string;
  /** The extension defines this kind in the open project: its accounts stay in the project. */
  projectOnly?: boolean;
  /** The setting that chooses the account the extension uses; without it the section only lists and adds accounts. */
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
    /** Two radio slots instead of one; `value` is then the project's effective account. */
    layers?: {
      projectName: string;
      /** The account User level uses. */
      userValue?: string;
      /** The User slot cannot be changed. */
      userDisabled: boolean;
      onSelectUser: (id: string) => void;
    };
  };
};
let { kind, icon, projectId, projectOnly = false, choice }: Props = $props();

const signInFlow = new AccountSignInFlow();
const project = $derived(
  projectId
    ? workspaceState.projects.find((candidate) => candidate.id === projectId)
    : undefined,
);
let dialogOpen = $state(false);
let editing = $state<AccountView | undefined>();
let checkErrors = $state<Record<string, string>>({});

function openAdd(): void {
  editing = undefined;
  dialogOpen = true;
}
function openEdit(account: AccountView): void {
  editing = account;
  dialogOpen = true;
}
async function retry(account: AccountView): Promise<void> {
  delete checkErrors[account.id];
  try {
    accountsState.setHealth(
      await testAccount({ kind: account.kind, id: account.id }),
    );
    await accountsState.load();
  } catch (cause) {
    checkErrors[account.id] =
      cause instanceof Error ? cause.message : "Could not test the connection.";
  }
}
async function saved(account: AccountView, added: boolean): Promise<void> {
  await accountsState.load();
  // The first account of a setting becomes the one it uses.
  if (!added || !choice) return;
  const { layers } = choice;
  if (layers && account.level === "user") {
    if (!layers.userValue && !layers.userDisabled)
      layers.onSelectUser(account.id);
  } else if (
    !choice.value &&
    !choice.disabled &&
    (choice.scope === "project" || account.level === "user")
  )
    choice.onSelect(account.id);
}

const accounts = $derived(
  visibleAccounts(
    accountsState.accounts,
    (choice?.scope ?? (projectId ? "project" : "user")) === "project"
      ? projectId
      : undefined,
  ).filter((account) => account.kind === kind.kind),
);
</script>

<SettingsSection
  id={choice ? "accounts" : `accounts-${kind.kind}`}
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
    {#if choice?.change && !choice.layers}
      <SettingsChangeIndicator
        scope={choice.scope}
        from={choice.change.from}
        onReset={choice.onReset}
      />
    {/if}
    {#if accounts.length > 0}
      <Button variant="outline" size="sm" onclick={openAdd}>
        <Plus class="size-3.5" aria-hidden="true" />Add account
      </Button>
    {/if}
  {/snippet}

  {#if accounts.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={KeyRound}
      title={`No ${kind.label}s`}
      description={projectOnly
        ? "This extension is defined by the project, so its accounts stay in the project."
        : "Add one to let the extension reach the service."}
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={openAdd}>
          <Plus class="size-3.5" aria-hidden="true" />Add account
        </Button>
      {/snippet}
    </SettingsEmptyState>
  {:else}
    {#if choice?.layers}
      <div class="flex justify-end pr-3">
        <ColumnLabels
          chevron
          projectName={choice.layers.projectName}
          {projectOnly}
        />
      </div>
      {@render list()}
    {:else if choice}
      <RadioGroup.Root
        value={choice.value ?? ""}
        disabled={choice.disabled}
        onValueChange={choice.onSelect}
        aria-label={choice.title}
        class="rounded-[inherit]"
      >
        {@render list()}
      </RadioGroup.Root>
    {:else}
      {@render list()}
    {/if}
  {/if}
</SettingsSection>

{#snippet radio(
  checked: boolean,
  label: string,
  disabled: boolean,
  onclick: () => void,
)}
  <span class="flex w-9 justify-center"
    ><button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      {disabled}
      class="flex size-4 items-center justify-center rounded-full border border-input bg-background focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
      {onclick}
    >
      {#if checked}<span class="size-2 rounded-full bg-primary"></span>{/if}
    </button></span
  >
{/snippet}

{#snippet list()}
  <SettingsList ariaLabel={`${kind.label}s`}>
    {#each accounts as account (account.id)}
      {#snippet mark()}
        <RadioGroup.Item
          value={account.id}
          aria-label={`Use ${account.name}`}
          disabled={choice?.disabled}
        />
      {/snippet}
      {#snippet lead()}
        <ExtensionMark {icon} />
      {/snippet}
      {#snippet slots()}
        {@const layers = choice?.layers}
        {#if layers}
          <div
            class="flex items-center"
            role="radiogroup"
            aria-label={`${account.name} is used by`}
          >
            <div class="flex w-20 justify-end">
              {#if account.level !== "project" && !projectOnly}
                {@render radio(
                  layers.userValue === account.id,
                  `Use ${account.name} at User level`,
                  layers.userDisabled,
                  () => layers.onSelectUser(account.id),
                )}
              {/if}
            </div>
            <div class="flex w-20 justify-end">
              {@render radio(
                choice?.value === account.id,
                `Use ${account.name} in ${layers.projectName}`,
                choice?.disabled === true,
                () => choice?.onSelect(account.id),
              )}
            </div>
          </div>
        {/if}
      {/snippet}
      <SettingsItem
        title={account.name}
        summary={accountSummary({ account, kind }) ??
          (account.level === "project"
            ? "Project account"
            : "Credentials stored")}
        problem={checkErrors[account.id]
          ? "Couldn’t test the connection"
          : account.state === "ready"
            ? undefined
            : account.state === "needs_sign_in"
              ? "Needs sign-in"
              : (account.error ?? "Credential does not work")}
        problemAction={checkErrors[account.id] || account.state === "failed"
          ? { label: "Retry", onclick: () => void retry(account) }
          : account.state === "needs_sign_in" &&
              signInFlow.signIn.supports(kind)
            ? {
                label: "Sign in",
                onclick: () => void signInFlow.signIn.start(account),
              }
            : account.state === "ready"
              ? undefined
              : { label: "Edit", onclick: () => openEdit(account) }}
        onOpen={() => openEdit(account)}
        openLabel={`Edit ${account.name}`}
        select={choice && !choice.layers ? mark : undefined}
        meta={choice?.layers ? slots : undefined}
        leading={lead}
      ></SettingsItem>
    {/each}
  </SettingsList>
{/snippet}

<AccountDialog
  bind:open={dialogOpen}
  {kind}
  account={editing}
  project={project ? { id: project.id, name: project.name } : undefined}
  {projectOnly}
  onSaved={(account) => void saved(account, editing === undefined)}
/>
<AccountSignInDialog flow={signInFlow} closeOnSuccess />
