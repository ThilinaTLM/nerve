<script lang="ts">
import { untrack } from "svelte";
import Compass from "@lucide/svelte/icons/compass";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  settingsNavFor,
  settingsPageFor,
} from "$lib/features/settings/registry/settings-pages";
import { userSettingsScope } from "$lib/features/settings/registry/settings-scope";
import { loadSettingsPanel } from "$lib/application/settings/settings-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { discoverTitlebarBadge, openDiscoverPane } from "$lib/app/discover";
import { openMobileCenter } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";

/**
 * User settings index: the nav groups as sections, one row per page, each
 * opening the same page body the desktop renders. Project settings live on
 * the project's own screen.
 */
const discoverBadge = $derived(discoverTitlebarBadge());
const status = $derived(workspaceSelectors.status);
const groups = settingsNavFor(userSettingsScope);

$effect(() => {
  untrack(() => void loadSettingsPanel());
});
</script>

{#snippet discoverDot()}
  <span class="size-2 rounded-full bg-info" aria-label="New"></span>
{/snippet}

<MobileScreen
  title="Settings"
  subtitle={status?.version ? `Nerve v${status.version}` : undefined}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#each groups as group (group.id)}
    <MobileSection title={group.title}>
      {#each group.items as item (item.id)}
        <MobileListRow
          title={item.label}
          detail={settingsPageFor(userSettingsScope, item.id).description}
          icon={item.icon}
          onclick={() =>
            pushMobileScreen({ kind: "settings-page", pageId: item.id })}
        />
      {/each}
    </MobileSection>
  {/each}

  <MobileSection>
    <MobileListRow
      title="Discover"
      detail="Release notes, tips and setup"
      icon={Compass}
      count={discoverBadge.kind === "count" ? discoverBadge.value : undefined}
      trailing={discoverBadge.kind === "dot" ? discoverDot : undefined}
      onclick={() => void openMobileCenter("discover", openDiscoverPane)}
    />
  </MobileSection>
</MobileScreen>
