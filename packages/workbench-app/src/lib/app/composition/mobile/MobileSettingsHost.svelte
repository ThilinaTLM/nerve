<script lang="ts">
import { untrack } from "svelte";
import Compass from "@lucide/svelte/icons/compass";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { settingsPages } from "$lib/features/settings/registry/settings-pages";
import { loadSettingsPanel } from "$lib/application/settings/settings-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { discoverTitlebarBadge, openDiscoverPane } from "$lib/app/discover";
import { openMobileCenter } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import {
  PROJECT_SCOPED_SETTINGS_PAGES,
  mobileSettingsScope,
} from "./mobile-settings-scope.svelte";

/**
 * Settings index: one row per page, each opening the same page body the
 * desktop renders. The scope switch narrows the list to project-scoped pages.
 */
const activeProject = $derived(workspaceSelectors.activeProject);
const discoverBadge = $derived(discoverTitlebarBadge());
const status = $derived(workspaceSelectors.status);
const scope = $derived(activeProject ? mobileSettingsScope.current : "user");
const pages = $derived(
  scope === "project"
    ? settingsPages.filter((page) =>
        PROJECT_SCOPED_SETTINGS_PAGES.includes(page.id),
      )
    : settingsPages,
);

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
  <div class="px-3 pt-3">
    <ToggleGroup.Root
      type="single"
      size="sm"
      variant="outline"
      class="w-full"
      value={scope}
      aria-label="Settings scope"
      onValueChange={(value) => {
        if (value === "user" || value === "project")
          mobileSettingsScope.current = value;
      }}
    >
      <ToggleGroup.Item value="user" class="flex-1">User</ToggleGroup.Item>
      <ToggleGroup.Item value="project" class="flex-1" disabled={!activeProject}
        >{activeProject?.name ?? "Project"}</ToggleGroup.Item
      >
    </ToggleGroup.Root>
  </div>

  <MobileSection>
    {#each pages as page (page.id)}
      <MobileListRow
        title={page.label}
        detail={page.description}
        icon={page.icon}
        onclick={() =>
          pushMobileScreen({ kind: "settings-page", pageId: page.id })}
      />
    {/each}
  </MobileSection>

  {#if scope === "user"}
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
  {/if}
</MobileScreen>
