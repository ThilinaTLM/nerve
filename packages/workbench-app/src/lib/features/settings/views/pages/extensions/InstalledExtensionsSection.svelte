<!--
  Installed extensions of one source (User or Project) as a list: every folder
  the host found, with its state, path and diagnostics. A pending extension
  opens its consent review; a loaded one opens its settings like a built-in.
-->
<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import ShieldOff from "@lucide/svelte/icons/shield-off";
import type {
  ExtensionCatalogEntry,
  ExtensionView,
} from "@nervekit/contracts/extensions";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import {
  SettingsEmptyState,
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";
import ExtensionConsentDialog from "./ExtensionConsentDialog.svelte";
import ExtensionMark from "./ExtensionMark.svelte";
import {
  installedProblem,
  installedStateBadge,
  installedSummary,
  installedSwitch,
  type AccountChoices,
  type InstalledGroup,
} from "./extensions-view";
import { extensionSummary } from "./extensions-view";

type Props = {
  source: InstalledGroup;
  entries: ExtensionCatalogEntry[];
  /** The registered (loaded) extensions, by id. */
  registered: ReadonlyMap<string, ExtensionView>;
  extensions: ScopedExtensionsState;
  accounts: AccountChoices;
  onOpenItem?: (id: string) => void;
};

let { source, entries, registered, extensions, accounts, onOpenItem }: Props =
  $props();

const title = $derived(source === "user" ? "User" : "Project");
const description = $derived(
  source === "user"
    ? "Installed in your Nerve home. They apply to every project."
    : "Installed in this project's .nerve/extensions folder.",
);
let reviewing = $state<ExtensionCatalogEntry>();
let reviewOpen = $state(false);

function review(entry: ExtensionCatalogEntry): void {
  reviewing = entry;
  reviewOpen = true;
}
</script>

<SettingsSection {title} {description}>
  {#snippet actions()}
    <Button
      size="sm"
      variant="outline"
      disabled={extensions.saving}
      onclick={() => void extensions.reloadInstalled()}>Reload</Button
    >
  {/snippet}
  {#if entries.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={Blocks}
      title={`No ${title.toLowerCase()} extensions`}
      description={source === "user"
        ? "Ask the agent to create one, or add a folder under agent/extensions in your Nerve home."
        : "Add a folder under .nerve/extensions in the project."}
    />
  {:else}
    <SettingsList ariaLabel={`${title} extensions`}>
      {#each entries as entry (`${entry.source}/${entry.path ?? entry.id}`)}
        {@const view =
          entry.state === "enabled" ? registered.get(entry.id) : undefined}
        {@const badge = installedStateBadge(entry.state)}
        {@const on = installedSwitch(entry)}
        <SettingsItem
          title={entry.name ?? entry.id}
          summary={view
            ? extensionSummary(view, accounts)
            : installedSummary(entry)}
          mono={!view}
          problem={installedProblem(entry)}
          problemAction={entry.state === "pending_consent" && entry.consent
            ? { label: "Review", onclick: () => review(entry) }
            : undefined}
          checked={on}
          disabled={extensions.saving}
          switchLabel={`Enable ${entry.name ?? entry.id}`}
          onCheckedChange={(next) =>
            void extensions.setInstalledEnabled(entry, next)}
          muted={entry.state !== "enabled"}
          onOpen={view && onOpenItem
            ? () => onOpenItem(entry.id)
            : entry.state === "pending_consent" && entry.consent
              ? () => review(entry)
              : undefined}
          openLabel={view
            ? `Open ${entry.name ?? entry.id}`
            : `Review ${entry.name ?? entry.id}`}
        >
          {#snippet leading()}
            {#if view}
              <ExtensionMark icon={view.metadata.icon} />
            {:else}
              <Blocks class="size-4 text-muted-foreground" aria-hidden="true" />
            {/if}
          {/snippet}
          {#snippet badges()}
            {#if badge}<Badge variant={badge.variant}>{badge.label}</Badge>{/if}
          {/snippet}
          {#snippet actions()}
            {#if entry.state === "enabled" || entry.state === "disabled"}
              <IconAction
                icon={ShieldOff}
                label={`Revoke consent for ${entry.name ?? entry.id}`}
                disabled={extensions.saving}
                onclick={() => void extensions.revokeConsent(entry)}
              />
            {/if}
          {/snippet}
        </SettingsItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>
<ExtensionConsentDialog
  bind:open={reviewOpen}
  entry={reviewing}
  busy={extensions.saving}
  onAllow={(entry) => void extensions.grantConsent(entry)}
/>
