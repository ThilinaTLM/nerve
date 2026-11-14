<!--
  Settings → Extensions: the built-in extensions as one list, and the detail
  view of one extension when `itemId` names it. Works on user and project
  scope; a project shows what differs from the user's settings.
-->
<script lang="ts">
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import Blocks from "@lucide/svelte/icons/blocks";
import { tick } from "svelte";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import type { AuthProviderMetadata, ModelInfo } from "$lib/api";
import { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  SettingsChangeIndicator,
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";
import { settingsSectionDomId } from "$lib/presentation/settings/section-id";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import { accountOptions } from "../tools/tool-settings";
import ExtensionDetail from "./ExtensionDetail.svelte";
import ExtensionsTrustNotice from "./ExtensionsTrustNotice.svelte";
import { extensionIcon } from "./extension-icons";
import {
  entryWithEnabled,
  extensionChanges,
  extensionFix,
  extensionProblem,
  extensionSummary,
} from "./extensions-view";

type Props = {
  scope: "user" | "project";
  projectId?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  /** The open extension; "" shows the list. */
  itemId?: string;
  /** Section a deep link asks for once the item has loaded. */
  sectionId?: string;
  onOpenItem?: (id: string, section?: string) => void;
};

let {
  scope,
  projectId,
  models = [],
  authProviders = [],
  itemId = "",
  sectionId,
  onOpenItem,
}: Props = $props();

const extensions = new ScopedExtensionsState();
$effect(() => {
  if (
    !workbenchStartupState.progressiveActive ||
    (scope === "project" && !projectId)
  )
    return;
  void extensions.load(
    scope === "project"
      ? { scope: "project", projectId: projectId! }
      : { scope: "user" },
  );
});
$effect(() => extensions.observe());
// Availability follows accounts and their credentials.
$effect(() => {
  const stop = [
    onEvent("settings.updated", () => void extensions.reload()),
    onEvent("accounts.changed", () => void extensions.reload()),
    onEvent("accounts.health_changed", () => void extensions.reload()),
  ];
  return () => stop.forEach((off) => off());
});

const view = $derived(extensions.view);
const accounts = $derived(
  accountOptions(accountsState.accounts, accountsState.kinds),
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const rows = $derived(
  (view?.extensions ?? []).map((extension) => {
    const inherited = extensions.inherited?.extensions.find(
      (candidate) => candidate.metadata.id === extension.metadata.id,
    );
    return {
      extension,
      inherited,
      changes: extensionChanges(extension, scope, accounts, inherited),
      problem: extensionProblem(extension),
      fix: extensionFix(extension, accounts),
    };
  }),
);
const differing = $derived(
  scope === "project"
    ? rows.reduce((total, row) => total + row.changes.length, 0)
    : 0,
);
const open = $derived(
  itemId
    ? view?.extensions.find((extension) => extension.metadata.id === itemId)
    : undefined,
);
const openRow = $derived(rows.find((row) => row.extension === open));
const busy = $derived(extensions.saving || !view);
let confirmReset = $state(false);
let listElement = $state<HTMLElement>();

// The shell scrolls to a deep-linked section when the detail opens, which can
// be before the extension view has loaded. Scroll again once it has.
let revealed = "";
$effect(() => {
  const key = open && sectionId ? `${itemId}/${sectionId}` : "";
  if (!key) {
    revealed = "";
    return;
  }
  if (revealed === key) return;
  revealed = key;
  const section = sectionId!;
  void tick().then(() =>
    document
      .getElementById(settingsSectionDomId(section))
      ?.scrollIntoView({ block: "start", behavior: "instant" }),
  );
});

// Back from a detail returns focus to the row that opened it.
let lastItem = "";
$effect(() => {
  const now = itemId;
  const previous = lastItem;
  lastItem = now;
  if (now || !previous || !view) return;
  const label = `Open ${view.extensions.find((e) => e.metadata.id === previous)?.metadata.name}`;
  void tick().then(() =>
    [...(listElement?.querySelectorAll<HTMLElement>("button") ?? [])]
      .find((button) => button.getAttribute("aria-label") === label)
      ?.focus({ preventScroll: true }),
  );
});

function resetAll(): void {
  void extensions.resetAll(
    rows
      .filter((row) => row.changes.length > 0)
      .map((row) => row.extension.metadata.id),
  );
}
</script>

{#if scope === "project"}<ExtensionsTrustNotice {extensions} />{/if}
{#if extensions.error}
  <Callout layout="block" tone="destructive" text={extensions.error}>
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => void extensions.reload()}>Reload</Button
      >
    {/snippet}
  </Callout>
{/if}
{#each view?.diagnostics.filter((d) => d.code === "file-unavailable") ?? [] as diagnostic (diagnostic.message)}
  <Callout layout="block" tone="destructive" text={diagnostic.message} />
{/each}

{#if !view}
  {#if !extensions.error}<Skeleton class="h-10 w-full" />{/if}
{:else if itemId}
  {#if open && openRow}
    <ExtensionDetail
      extension={open}
      inherited={openRow.inherited}
      {scope}
      {projectId}
      {extensions}
      {accounts}
      models={usableModels}
    />
  {:else}
    <SettingsEmptyState
      variant="card"
      icon={Blocks}
      title="Extension not found"
      description={`No extension is registered as “${itemId}”.`}
    />
  {/if}
{:else}
  <div bind:this={listElement} class="grid min-w-0">
    <SettingsSection id="builtin" title="Built-in">
      {#snippet actions()}
        {#if differing > 0}
          <span class="text-ui text-muted-foreground"
            >{differing} differ from your settings</span
          >
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onclick={() => (confirmReset = true)}>Reset all</Button
          >
        {/if}
      {/snippet}
      <SettingsList ariaLabel="Built-in extensions">
        {#each rows as row (row.extension.metadata.id)}
          {@const extension = row.extension}
          <SettingsItem
            title={extension.metadata.name}
            icon={extensionIcon(extension.metadata.icon)}
            summary={extensionSummary(extension, accounts)}
            problem={row.problem}
            problemAction={row.fix
              ? {
                  label: row.fix.label,
                  onclick: () =>
                    onOpenItem?.(extension.metadata.id, row.fix?.section),
                }
              : undefined}
            checked={extension.enabled.value}
            disabled={busy || extension.readOnly}
            lockedBy={extension.enabled.source.locked
              ? (extension.enabled.source.profile ?? "profile")
              : undefined}
            switchLabel={`Enable ${extension.metadata.name}`}
            onCheckedChange={(next) =>
              void extensions.save(
                extension.metadata.id,
                entryWithEnabled(extension, next),
              )}
            onOpen={onOpenItem
              ? () => onOpenItem(extension.metadata.id)
              : undefined}
            openLabel={`Open ${extension.metadata.name}`}
          >
            {#snippet meta()}
              {#if row.changes.length > 0}
                <SettingsChangeIndicator
                  compact
                  {scope}
                  from={row.changes
                    .map((change) => `${change.label} ${change.from}`)
                    .join(", ")}
                  to={row.changes
                    .map((change) => `${change.label} ${change.to}`)
                    .join(", ")}
                  onReset={() => void extensions.reset(extension.metadata.id)}
                />
              {/if}
            {/snippet}
          </SettingsItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  </div>
  <ConfirmDialog
    bind:open={confirmReset}
    title="Reset Extensions for this project?"
    description={`Removes ${differing} project ${differing === 1 ? "override" : "overrides"}. Extensions will follow your user settings again.`}
    confirmLabel="Reset all"
    destructive
    onConfirm={resetAll}
  />
{/if}
