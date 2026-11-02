<script lang="ts">
import FolderOpen from "@lucide/svelte/icons/folder-open";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { ProjectIcon, type ProjectSwitcherItem } from "$lib/features/projects";
import { tildePath } from "$lib/domain/filesystem/project-path";
import { workspaceSelectors, workspaceState } from "$lib/application/workspace";
import MobileNewChatFab from "./MobileNewChatFab.svelte";
import MobileRootActions from "./MobileRootActions.svelte";
import { groupMobileProjects, projectCountsLine } from "./mobile-projects";
import { pushMobileScreen } from "./mobile-shell.svelte";

/**
 * Projects tab root. On a phone the project is a top-level destination, not a
 * popover anchored to a corner: projects with live work come first with a
 * count line, the rest follow by recency, each opening that project's home.
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
const groups = $derived(
  groupMobileProjects(
    filtered,
    workspaceSelectors.conversations,
    workspaceSelectors.conversationActivityById,
  ),
);

function recentDetail(item: ProjectSwitcherItem): string {
  const parsed = Date.parse(item.sortAt);
  return [
    tildePath(item.project.directory, homeDir),
    Number.isNaN(parsed) ? "" : relativeTimeLabel(item.sortAt),
  ]
    .filter(Boolean)
    .join(" · ");
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

{#snippet projectRow(item: ProjectSwitcherItem, detail: string)}
  <MobileListRow
    title={item.project.name}
    {detail}
    selected={item.key === workspaceState.selectedProjectKey}
    onclick={() => choose(item)}
  >
    {#snippet leading()}
      <ProjectIcon projectId={item.project.id} class="size-8" />
    {/snippet}
  </MobileListRow>
{/snippet}

<MobileNewChatFab>
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

    {#if groups.active.length}
      <MobileSection title="Active" meta={`${groups.active.length}`}>
        {#each groups.active as entry (entry.item.key)}
          {@render projectRow(entry.item, projectCountsLine(entry.counts))}
        {/each}
      </MobileSection>
    {/if}

    {#if groups.recent.length}
      <MobileSection title={groups.active.length ? "Recent" : "Projects"}>
        {#each groups.recent as item (item.key)}
          {@render projectRow(item, recentDetail(item))}
        {/each}
      </MobileSection>
    {:else if !groups.active.length}
      <p class="px-6 py-12 text-center text-ui text-muted-foreground">
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
</MobileNewChatFab>
