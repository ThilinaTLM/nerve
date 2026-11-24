<script lang="ts">
import type { Settings, UpdateSettingsRequest } from "$lib/api";
import type { SettingsPageDef } from "$lib/presentation/settings";
import type { Project } from "@nervekit/contracts/core";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import {
  PROJECT_COLUMN_PAGES,
  type ProjectColumnPage,
} from "$lib/features/settings/state/project-columns";
import {
  projectColumns,
  setProjectColumn,
} from "$lib/features/settings/state/project-columns.svelte";
import { ProjectColumnsToggle } from "$lib/presentation/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import StoragePageActions from "$lib/features/settings/views/pages/storage/StoragePageActions.svelte";
import ProfilesPageActions from "$lib/features/settings/views/pages/agent-profiles/ProfilesPageActions.svelte";
import SuggestionsPageActions from "./suggestions/SuggestionsPageActions.svelte";
import type { SettingsPageControllers } from "./settings-page-controllers.svelte";

/** Header actions owned by a settings page (new, reload, cleanup, the project-column switch). */
let {
  page,
  controllers,
  settingsDraft,
  project,
}: {
  page: SettingsPageDef;
  controllers: SettingsPageControllers;
  settingsDraft?: Settings;
  /** The open project, when the surface shows one. */
  project?: Project;
  onSettingsChange?: (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;
} = $props();

// General and Tools are User-only until the header switch adds the project's column.
const columnPage = $derived(
  project && (PROJECT_COLUMN_PAGES as readonly string[]).includes(page.id)
    ? (page.id as ProjectColumnPage)
    : undefined,
);
</script>

{#if settingsDraft}
  {#if project && columnPage}
    <ProjectColumnsToggle
      id={`project-columns-${columnPage}`}
      checked={projectColumns[columnPage]}
      count={controllers.projectOverrideCount(columnPage)}
      onCheckedChange={(shown) => setProjectColumn(columnPage, shown)}
    />
  {/if}
  {#if page.id === "suggestions"}
    <SuggestionsPageActions pageState={controllers.suggestionsPageState} />
  {:else if page.id === "extensions"}
    {@const extensionsPage = controllers.extensionsPageController}
    <Button
      size="sm"
      variant="outline"
      disabled={extensionsPage.busy || !extensionsPage.reload}
      onclick={() => void extensionsPage.run()}
      ><RefreshCw class="size-3.5" />Reload</Button
    >
  {:else if page.id === "launch"}
    <Button
      size="sm"
      variant="outline"
      disabled={!project}
      onclick={() => controllers.openLaunchDialog()}
      ><Plus class="size-3.5" />New launch</Button
    >
  {:else if page.id === "mcp-servers"}
    <Button
      size="sm"
      variant="outline"
      onclick={() => (controllers.mcpAddOpen = true)}
      ><Plus class="size-3.5" />Add server</Button
    >
  {:else if page.id === "agents" || page.id === "sub-agents"}
    <ProfilesPageActions pageId={page.id} />
  {:else if page.id === "storage"}
    <StoragePageActions controller={controllers.storageController} />
  {/if}
{/if}
