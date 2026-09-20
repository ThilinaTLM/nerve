<script lang="ts">
import Compass from "@lucide/svelte/icons/compass";
import Logs from "@lucide/svelte/icons/logs";
import Settings from "@lucide/svelte/icons/settings";
import FolderSearch from "@lucide/svelte/icons/folder-search";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { openDiscoverPane } from "$lib/app/discover";
import { openLogsPane } from "$lib/features/logs";
import { openSettingsPane } from "$lib/application/settings";
import { workspaceSelectors, workspaceState } from "$lib/application/workspace";
import MobileStatusStrip from "./MobileStatusStrip.svelte";

/** Everything that is not triage: app panes, projects, and daemon health. */
const status = $derived(workspaceSelectors.status);
const applicationLogsEnabled = $derived(
  status?.capabilities.applicationLogs ?? false,
);

function browseProjects() {
  workspaceState.projectPickerMode = "browse";
  workspaceState.projectPickerOpen = true;
}
</script>

<MobileScreen
  title="More"
  subtitle={status?.version ? `Nerve v${status.version}` : undefined}
>
  <MobileStatusStrip />

  <MobileSection title="Workspace">
    <MobileListRow
      title="Open a project"
      detail="Browse the filesystem for a project directory"
      icon={FolderSearch}
      onclick={browseProjects}
    />
  </MobileSection>

  <MobileSection title="Application">
    <MobileListRow
      title="Settings"
      detail="Models, providers, permissions and appearance"
      icon={Settings}
      onclick={() => void openSettingsPane()}
    />
    <MobileListRow
      title="Discover"
      detail="Release notes, tips and setup"
      icon={Compass}
      onclick={openDiscoverPane}
    />
    {#if applicationLogsEnabled}
      <MobileListRow
        title="Logs"
        detail="Daemon and application logs"
        icon={Logs}
        onclick={() => openLogsPane()}
      />
    {/if}
  </MobileSection>
</MobileScreen>
