<script lang="ts">
import FolderSearch from "@lucide/svelte/icons/folder-search";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { ProjectIcon, type ProjectSwitcherItem } from "$lib/features/projects";
import { tildePath } from "$lib/domain/filesystem/project-path";
import {
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";
import { backFromMobileDetail } from "./mobile-shell.svelte";

/**
 * Project picker as a page. On a phone the project is a top-level destination,
 * not a popover anchored to a corner, so it gets a full screen with large rows
 * and a per-project activity summary.
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
      item.project.dir.toLowerCase().includes(needle),
  );
});

function activityDetail(item: ProjectSwitcherItem): string {
  const parts: string[] = [];
  if (item.activity.needsUser) parts.push(`${item.activity.needsUser} waiting`);
  if (item.activity.failed) parts.push(`${item.activity.failed} failed`);
  if (item.activity.running) parts.push(`${item.activity.running} running`);
  if (item.tasks.running)
    parts.push(
      item.tasks.running === 1 ? "1 task" : `${item.tasks.running} tasks`,
    );
  if (parts.length) return parts.join(" · ");
  return tildePath(item.project.dir, homeDir);
}

function activityTone(item: ProjectSwitcherItem) {
  if (item.activity.failed) return "destructive" as const;
  if (item.activity.needsUser) return "warning" as const;
  if (item.activity.running || item.tasks.running) return "info" as const;
  return undefined;
}

function choose(item: ProjectSwitcherItem) {
  backFromMobileDetail();
  void selectProject(item.project.id);
}

function browse() {
  backFromMobileDetail();
  workspaceState.projectPickerMode = "browse";
  workspaceState.projectPickerOpen = true;
}
</script>

<MobileScreen
  title="Projects"
  subtitle={`${items.length} known`}
  onBack={backFromMobileDetail}
  backLabel="Close projects"
>
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
          pulse={Boolean(item.activity.running || item.tasks.running)}
          selected={item.key === workspaceState.selectedProjectKey}
          chevron={false}
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
      title="Browse for a project"
      detail="Open a directory from the filesystem"
      icon={FolderSearch}
      onclick={browse}
    />
  </MobileSection>
</MobileScreen>
