<!--
  The account setting of an extension: the accounts of one kind with a radio in
  each row that chooses one. The section takes the field's title, description,
  change indicator and lock. Accounts are managed on the Accounts page, which
  the section links to, filtered to the extension. A user-scope setting offers
  user-level accounts; a project setting also offers that project's.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import type {
  AccountKind,
  ExtensionIcon,
} from "@nervekit/contracts/extensions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import {
  SettingsChangeIndicator,
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";
import { accountSummary, visibleAccounts } from "../accounts/accounts-view";
import ExtensionMark from "./ExtensionMark.svelte";
import type { ExtensionChange, ExtensionsScope } from "./extensions-view";

type Props = {
  kind: AccountKind;
  /** The owning extension's mark. */
  icon: ExtensionIcon;
  /** The project of a project-scope setting. */
  projectId?: string;
  /** Opens the Accounts page filtered to this extension. */
  onManage: () => void;
  choice: {
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
let { kind, icon, projectId, onManage, choice }: Props = $props();

const accounts = $derived(
  visibleAccounts(
    accountsState.accounts,
    choice.scope === "project" ? projectId : undefined,
  ).filter((account) => account.kind === kind.kind),
);
</script>

<SettingsSection
  id="accounts"
  title={choice.title}
  description={choice.description}
>
  {#snippet actions()}
    {#if choice.lockedReason}
      <span class="inline-flex" title={choice.lockedReason}>
        <Lock
          class="size-3.5 text-muted-foreground"
          aria-label={choice.lockedReason}
        />
      </span>
    {/if}
    {#if choice.change}
      <SettingsChangeIndicator
        scope={choice.scope}
        from={choice.change.from}
        onReset={choice.onReset}
      />
    {/if}
    <Button variant="outline" size="sm" onclick={onManage}
      >Manage accounts</Button
    >
  {/snippet}

  {#if accounts.length === 0}
    <SettingsEmptyState
      variant="card"
      title={`No ${kind.label}s`}
      description="Add an account on the Accounts page."
    />
  {:else}
    <RadioGroup.Root
      value={choice.value ?? ""}
      disabled={choice.disabled}
      onValueChange={choice.onSelect}
      aria-label={choice.title}
      class="rounded-[inherit]"
    >
      <SettingsList ariaLabel={`${kind.label}s`}>
        {#each accounts as account (account.id)}
          {#snippet mark()}
            <RadioGroup.Item
              value={account.id}
              aria-label={`Use ${account.name}`}
              disabled={choice.disabled}
            />
          {/snippet}
          {#snippet lead()}
            <ExtensionMark {icon} />
          {/snippet}
          <SettingsItem
            title={account.name}
            summary={accountSummary({ account, kind }) ??
              (account.level === "project"
                ? "Project account"
                : "Credentials stored")}
            problem={account.state === "ready"
              ? undefined
              : account.state === "needs_sign_in"
                ? "Needs credentials"
                : (account.error ?? "Credential does not work")}
            problemAction={account.state === "ready"
              ? undefined
              : { label: "Fix", onclick: onManage }}
            select={mark}
            leading={lead}
          ></SettingsItem>
        {/each}
      </SettingsList>
    </RadioGroup.Root>
  {/if}
</SettingsSection>
