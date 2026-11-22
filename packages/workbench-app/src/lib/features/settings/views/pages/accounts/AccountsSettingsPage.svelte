<!--
  Settings → Accounts: an index of every account, grouped by level (the open
  project first, then User), where accounts are tested, moved, duplicated,
  signed in, cleared and deleted. Accounts are added and edited on the page of
  the extension that uses them; opening a row goes there. A search appears
  once there are many accounts.
-->
<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import KeyRound from "@lucide/svelte/icons/key-round";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ExtensionsView } from "@nervekit/contracts/extensions";
import type { AccountLevel } from "@nervekit/contracts/settings";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import type { AccountView } from "$lib/api";
import { deleteAccount, testAccount } from "$lib/api";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import {
  clearAccountCredentials,
  duplicateAccount,
  moveAccount,
} from "$lib/features/settings/api/accounts.api";
import AccountHealthIcon from "$lib/presentation/integrations/AccountHealthIcon.svelte";
import { accountHealthBadge } from "$lib/presentation/integrations/account-health";
import {
  SettingsEmptyState,
  OriginGroup,
  SETTINGS_SEARCH_MIN,
  SettingsItem,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import ExtensionMark from "../extensions/ExtensionMark.svelte";
import { accountCanTest } from "../extensions/account-form";
import {
  accountProblem,
  accountRows,
  accountStateLabel,
  accountSummary,
  duplicateWarning,
  searchAccountRows,
  levelChoices,
  visibleAccounts,
  type AccountExtension,
  type AccountRowModel,
  type AccountSignIn,
} from "./accounts-view";

type Props = {
  /** Signs an OAuth account in; rows offer Sign in only for kinds it supports. */
  signIn?: AccountSignIn;
};
let { signIn }: Props = $props();

const projectId = $derived(selection.projectId);
const project = $derived(
  workspaceState.projects.find((candidate) => candidate.id === projectId),
);
let query = $state("");

// The extensions as the open project sees them: who defines each kind.
let extensionsView = $state.raw<ExtensionsView>();
$effect(() => {
  const target = projectId
    ? ({ scope: "project", projectId } as const)
    : ({ scope: "user" } as const);
  const load = () =>
    void requestWorkbench("extensions.get", { target })
      .then((view) => (extensionsView = view))
      .catch(() => {});
  load();
  const stop = onEvent("extensions.changed", load);
  return stop;
});
$effect(() => {
  void accountsState.loadHealth().catch(() => {});
});

const extensionsByKind = $derived.by(() => {
  const byKind: Record<string, AccountExtension> = {};
  for (const extension of extensionsView?.extensions ?? [])
    for (const kind of extension.accountKinds)
      byKind[kind.kind] = {
        id: extension.metadata.id,
        name: extension.metadata.name,
        projectOnly: extension.metadata.source === "project",
        icon: extension.metadata.icon,
      };
  return byKind;
});

const rows = $derived(
  accountRows(
    visibleAccounts(accountsState.accounts, projectId),
    accountsState.kinds,
    (kind) => extensionsByKind[kind],
  ),
);
const searchable = $derived(rows.length >= SETTINGS_SEARCH_MIN);
const shown = $derived(
  searchAccountRows(rows, searchable ? query : "", project?.name),
);
// Project accounts first, then User, as on the other lists.
const groups = $derived(
  (projectId ? (["project", "user"] as const) : (["user"] as const))
    .map((level) => ({
      level,
      rows: shown.filter((row) => row.account.level === level),
    }))
    .filter((group) => group.rows.length > 0),
);

let error = $state<string | undefined>();
let checking = $state<Record<string, boolean>>({});
let checkErrors = $state<Record<string, string>>({});
let pendingDelete = $state<AccountView | undefined>();
let pendingClear = $state<AccountView | undefined>();
let pendingDuplicate = $state<
  { row: AccountRowModel; level: AccountLevel; warning: string } | undefined
>();

const levelProject = (level: AccountLevel): string | null =>
  level === "project" ? (projectId ?? null) : null;

/** Runs an account action, showing the server's reason when it refuses. */
async function act(run: () => Promise<unknown>): Promise<void> {
  error = undefined;
  try {
    await run();
    await accountsState.load();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "The action failed.";
  }
}

async function test(account: AccountView): Promise<void> {
  if (checking[account.id]) return;
  checking[account.id] = true;
  delete checkErrors[account.id];
  try {
    accountsState.setHealth(
      await testAccount({ kind: account.kind, id: account.id }),
    );
  } catch (cause) {
    checkErrors[account.id] =
      cause instanceof Error ? cause.message : "Could not test the connection.";
  } finally {
    checking[account.id] = false;
  }
}

/** Opens the page of the extension that defines the account, where it is edited. */
function openExtension(row: AccountRowModel): void {
  if (!row.extension) return;
  const options = { item: row.extension.id };
  if (row.account.level === "project" && row.account.projectId)
    void openProjectSettingsPane(row.account.projectId, "extensions", options);
  else void openSettingsPane("extensions", options);
}

function duplicate(row: AccountRowModel, level: AccountLevel): void {
  const warning = duplicateWarning(
    row,
    row.kind !== undefined && signIn?.supports(row.kind) === true,
  );
  if (warning) pendingDuplicate = { row, level, warning };
  else void runDuplicate(row, level);
}
const runDuplicate = (row: AccountRowModel, level: AccountLevel) =>
  act(() =>
    duplicateAccount(
      { kind: row.account.kind, id: row.account.id },
      levelProject(level),
    ),
  );

const levelName = (level: AccountLevel) =>
  level === "user" ? "user level" : "project level";
</script>

<SettingsSection id="accounts" surface={false}>
  {#if error}
    <Callout layout="block" tone="destructive" text={error} />
  {/if}

  {#if searchable}
    <SettingsToolbar>
      {#snippet start()}
        <SearchInput
          bind:value={query}
          placeholder="Search accounts"
          ariaLabel="Search accounts"
          class="max-w-xs"
        >
          {#snippet trailing()}
            <span class="flex-none text-ui text-muted-foreground"
              >{shown.length} of {rows.length}</span
            >
          {/snippet}
        </SearchInput>
      {/snippet}
    </SettingsToolbar>
  {/if}

  {#if rows.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={KeyRound}
      title="No accounts"
      description="Add an account from the page of the extension that uses it."
    />
  {:else if shown.length === 0}
    <SettingsEmptyState
      variant="card"
      title="No matching accounts"
      description="Try a different search term."
    />
  {:else}
    {#each groups as group (group.level)}
      <OriginGroup
        origin={{ kind: group.level }}
        count={group.rows.length}
        projectName={project?.name}
        layers={false}
      >
        {#each group.rows as row (row.account.id)}
          {@render accountRow(row)}
        {/each}
      </OriginGroup>
    {/each}
  {/if}
</SettingsSection>

{#snippet accountRow(row: AccountRowModel)}
  {@const account = row.account}
  {@const choices = levelChoices(row, projectId)}
  {@const canSignIn = row.kind !== undefined && signIn?.supports(row.kind)}
  {@const health = accountsState.healthOf(account.kind, account.id)}
  {@const badge = accountHealthBadge(health)}
  {@const testable =
    row.kind !== undefined && accountCanTest(row.kind, account)}
  {@const unhealthy = badge.tone === "destructive" || badge.tone === "warning"}
  {@const problem =
    row.kind || account.state === "unavailable"
      ? accountProblem(account)
      : "No extension defines this kind"}
  {#snippet mark()}
    {#if row.extension}
      <ExtensionMark icon={row.extension.icon} />
    {:else}
      <KeyRound class="size-4 text-muted-foreground" aria-hidden="true" />
    {/if}
  {/snippet}
  {#snippet badges()}
    {#if account.state === "needs_sign_in"}
      <Badge variant="warning">{accountStateLabel(account.state)}</Badge>
    {/if}
  {/snippet}
  {#snippet rowActions()}
    {#if testable}
      <AccountHealthIcon
        {health}
        busy={checking[account.id]}
        onTest={() => void test(account)}
      />
    {/if}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={`More actions for ${account.name}`}
      >
        <Ellipsis class="size-4" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-60">
        {#if canSignIn}
          <DropdownMenu.Item onSelect={() => void signIn?.start(account)}
            >Sign in again</DropdownMenu.Item
          >
        {/if}
        {#if choices.move}
          <DropdownMenu.Item
            onSelect={() => {
              const level = choices.move!;
              void act(() =>
                moveAccount(
                  { kind: account.kind, id: account.id },
                  levelProject(level),
                ),
              );
            }}>Move to {levelName(choices.move)}</DropdownMenu.Item
          >
        {/if}
        {#each choices.duplicate as level (level)}
          <DropdownMenu.Item onSelect={() => duplicate(row, level)}
            ><Copy class="size-4" aria-hidden="true" />Duplicate to {levelName(
              level,
            )}</DropdownMenu.Item
          >
        {/each}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => (pendingClear = account)}
          >Clear credentials</DropdownMenu.Item
        >
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <IconAction
      icon={Trash2}
      label="Delete account"
      tone="destructive"
      onclick={() => (pendingDelete = account)}
    />
  {/snippet}
  <SettingsItem
    title={account.name}
    summary={[row.extension?.name, accountSummary(row)]
      .filter(Boolean)
      .join(" · ") || undefined}
    problem={problem ??
      (checkErrors[account.id]
        ? "Couldn’t test the connection"
        : testable && unhealthy
          ? badge.label
          : undefined)}
    problemAction={account.state === "needs_sign_in" && canSignIn
      ? { label: "Sign in", onclick: () => void signIn?.start(account) }
      : row.kind && (checkErrors[account.id] || account.state === "failed")
        ? { label: "Retry", onclick: () => void test(account) }
        : undefined}
    onOpen={row.extension ? () => openExtension(row) : undefined}
    openLabel={`Open ${row.extension?.name ?? account.name}`}
    leading={mark}
    {badges}
    actions={rowActions}
  ></SettingsItem>
{/snippet}

<ConfirmDialog
  open={!!pendingDelete}
  title="Delete account?"
  description={pendingDelete
    ? `Delete “${pendingDelete.name}” and its stored credentials? Extensions that use it need another account.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    const account = pendingDelete;
    pendingDelete = undefined;
    if (account)
      void act(() => deleteAccount({ kind: account.kind, id: account.id }));
  }}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
<ConfirmDialog
  open={!!pendingClear}
  title="Clear credentials?"
  description={pendingClear
    ? `Forget the stored credentials of “${pendingClear.name}”? The account stays and needs credentials again.`
    : ""}
  confirmLabel="Clear credentials"
  destructive
  onConfirm={() => {
    const account = pendingClear;
    pendingClear = undefined;
    if (account)
      void act(() =>
        clearAccountCredentials({ kind: account.kind, id: account.id }),
      );
  }}
  onOpenChange={(open) => {
    if (!open) pendingClear = undefined;
  }}
/>
<ConfirmDialog
  open={!!pendingDuplicate}
  title="Duplicate a signed-in account?"
  description={pendingDuplicate?.warning ?? ""}
  confirmLabel="Duplicate"
  onConfirm={() => {
    const pending = pendingDuplicate;
    pendingDuplicate = undefined;
    if (pending) void runDuplicate(pending.row, pending.level);
  }}
  onOpenChange={(open) => {
    if (!open) pendingDuplicate = undefined;
  }}
/>
