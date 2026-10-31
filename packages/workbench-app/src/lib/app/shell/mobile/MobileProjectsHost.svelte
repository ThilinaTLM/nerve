<script lang="ts">
import FolderOpen from "@lucide/svelte/icons/folder-open";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { ProjectIcon, type ProjectSwitcherItem } from "$lib/features/projects";
import { tildePath } from "$lib/domain/filesystem/project-path";
import { conversationRowStatusLabel } from "$lib/presentation/conversations/conversation-row-state";
import { workspaceSelectors, workspaceState } from "$lib/application/workspace";
import MobileRootActions from "./MobileRootActions.svelte";
import { pushMobileScreen } from "./mobile-shell.svelte";

/**
 * Projects tab root. On a phone the project is a top-level destination, not a
 * popover anchored to a corner: large rows with a per-project activity summary,
 * each opening that project's home screen.
 */
let query = $state("");

const items = $derived(workspaceSelectors.projectSwitcherItems);
const homeDir = $derived(workspaceSelectors.status?.storage.userHome);
const filtered = $derived.by(() => {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      item.project.name.toLowerCase().includes(needle) ||
      item.project.directory.toLowerCase().includes(needle),
  );
});

// Same vocabulary as the desktop header: one status per project, taken from
// its most urgent conversation; text only when it needs the user.
function activityDetail(item: ProjectSwitcherItem): string {
  return (
    conversationRowStatusLabel(item.activity) ??
    tildePath(item.project.directory, homeDir)
  );
}

function activityTone(item: ProjectSwitcherItem) {
  return item.activity.tone === "neutral" ? undefined : item.activity.tone;
}

function choose(item: ProjectSwitcherItem) {
  // Route activation selects the project once its home screen is on top.
  pushMobileScreen({ kind: "project", projectId: item.project.id });
}

function browse() {
  workspaceState.projectPickerPath = undefined;
  workspaceState.projectPickerOpen = true;
}
</script>

<MobileScreen title="Projects" subtitle={`${items.length} known`}>
  {#snippet actions()}
    <MobileRootActions />
  {/snippet}
  <div class="px-3 pt-2">
    <SearchInput
      bind:value={query}
      placeholder="Search projects"
      ariaLabel="Search projects"
    />
  </div>

  {#if filtered.length}
    <MobileSection>
      {#each filtered as item (item.key)}
        <MobileListRow
          title={item.project.name}
          detail={activityDetail(item)}
          meta={item.conversationCount === 1
            ? "1 chat"
            : `${item.conversationCount} chats`}
          tone={activityTone(item)}
          pulse={item.activity.pulse}
          selected={item.key === workspaceState.selectedProjectKey}
          onclick={() => choose(item)}
        >
          {#snippet leading()}
            <ProjectIcon projectId={item.project.id} class="size-8" />
          {/snippet}
        </MobileListRow>
      {/each}
    </MobileSection>
  {:else}
    <p class="px-6 py-12 text-center text-sm text-muted-foreground">
      No projects match your search.
    </p>
  {/if}

  <MobileSection>
    <MobileListRow
      title="Open folder"
      detail="Choose a folder to open as a project"
      icon={FolderOpen}
      onclick={browse}
    />
  </MobileSection>
</MobileScreen>
