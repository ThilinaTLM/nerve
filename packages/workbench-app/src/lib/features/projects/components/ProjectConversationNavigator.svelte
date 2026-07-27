<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { ProjectRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { NavigatorPanel } from "@nervekit/workbench-ui/components/navigator";
import { buildConversationRows } from "$lib/core/utils/project-tree";
import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
import ProjectConversationsDialog from "./ProjectConversationsDialog.svelte";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
import {
  buildConversationMenu,
  type ProjectTreeMenuContext,
} from "./project-tree-menus";
import type {
  DeleteTarget,
  ProjectAgentTreeProps,
} from "./project-agent-tree-props";

let {
  projects = [],
  conversations = [],
  agents = [],
  selectedProjectId,
  selectedConversationId,
  openConversationTabIds,
  conversationActivityById = {},
  searchFocusToken = 0,
  editorAvailability,
  homeDir,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  onDeleteConversation,
  onPruneProjectConversations,
}: ProjectAgentTreeProps = $props();

let filter = $state("");
let searchInputEl = $state<HTMLInputElement | null>(null);
let pendingDelete = $state<DeleteTarget | undefined>();
let allConversationsOpen = $state(false);
let viewportRef = $state<HTMLElement | null>(null);
let listRef = $state<HTMLDivElement | null>(null);
let visibleLimit = $state(8);

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const rows = $derived(
  buildConversationRows({ conversations, agents, projectIds, filter }),
);
const visibleRows = $derived(rows.slice(0, visibleLimit));
const searchShortcut = getShortcutLabel("projectSearch.focus");
const searchShortcutAria = getShortcutAriaLabel("projectSearch.focus");
const newConversationShortcut = getShortcutLabel("conversation.new");
const switchProjectShortcut = getShortcutLabel("conversation.newFromProject");
const emptyStateHint = switchProjectShortcut
  ? `Use the folder button in the header (${switchProjectShortcut}) to get started.`
  : "Use the folder button in the header to get started.";

function updateVisibleLimit(rowCount = rows.length) {
  if (rowCount === 0) {
    visibleLimit = 1;
    return;
  }
  if (!viewportRef || !listRef) return;
  const row = listRef.querySelector<HTMLElement>("[data-conversation-row]");
  const rowHeight = row?.getBoundingClientRect().height;
  if (!rowHeight) return;
  const viewportRect = viewportRef.getBoundingClientRect();
  const listRect = listRef.getBoundingClientRect();
  const inset = Math.max(0, listRect.top - viewportRect.top);
  const availableHeight = Math.max(
    rowHeight,
    viewportRef.clientHeight - inset * 2,
  );
  const capacity = Math.max(1, Math.floor(availableHeight / rowHeight));
  // Reserve one compact row for the overflow action plus rounding/inset slack
  // so the navigator viewport never becomes scrollable by a few pixels.
  visibleLimit = rowCount > capacity ? Math.max(1, capacity - 2) : capacity;
}

$effect(() => {
  if (!viewportRef) return;
  const rowCount = rows.length;
  const observer = new ResizeObserver(() =>
    requestAnimationFrame(() => updateVisibleLimit(rowCount)),
  );
  observer.observe(viewportRef);
  requestAnimationFrame(() => updateVisibleLimit(rowCount));
  return () => observer.disconnect();
});

const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir,
  newConversationShortcut,
  editorAvailability,
  conversationCount: (projectId) =>
    conversations.filter((conversation) => conversation.projectId === projectId)
      .length,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectInEditor,
  requestPrune: (project: ProjectRecord) =>
    onPruneProjectConversations?.(project.id, {
      strategy: "keepLatest",
      keepLatest: 20,
    }),
  requestDelete: (target) => (pendingDelete = target),
});
</script>

<NavigatorPanel
  bind:searchValue={filter}
  bind:searchRef={searchInputEl}
  bind:viewportRef
  placeholder="Search conversations"
  searchAriaLabel="Search conversations"
  {searchFocusToken}
  {searchShortcut}
  {searchShortcutAria}
>
  {#snippet searchActions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel={activeProject
        ? `New chat in ${activeProject.name}`
        : "New chat"}
      title="New chat"
      disabled={!activeProject}
      onclick={() => {
        if (activeProject) onNewConversationInProject?.(activeProject.dir);
      }}
    >
      <Plus class="size-4" aria-hidden="true" />
    </Button>
  {/snippet}
  {#if activeProject}
    <div class="flex flex-col" bind:this={listRef}>
      {#if rows.length === 0}
        <div
          class="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground"
        >
          <p>
            {filter
              ? "No conversations match your search."
              : "No conversations in this project yet."}
          </p>
          {#if !filter}
            <Button
              variant="outline"
              size="sm"
              onclick={() => onNewConversationInProject?.(activeProject.dir)}
              >New chat</Button
            >
          {/if}
        </div>
      {/if}
      {#each visibleRows as row (row.conversation.id)}
        {@const rowProject =
          projects.find(
            (project) => project.id === row.conversation.projectId,
          ) ?? activeProject}
        <div data-conversation-row>
          <ProjectAgentTreeNode
            {row}
            isOpen={openConversationTabIds?.has(row.conversation.id) ?? false}
            isActive={row.conversation.id === selectedConversationId}
            activity={conversationActivityById[row.conversation.id]}
            menuItems={buildConversationMenu(
              rowProject,
              row.conversation,
              menuContext,
            )}
            {onOpenConversation}
          />
        </div>
      {/each}
      {#if rows.length > visibleRows.length}
        <Button
          variant="ghost"
          size="xs"
          class="mx-auto mt-0.5 h-6 w-fit px-2 py-0 text-xs text-muted-foreground"
          onclick={() => (allConversationsOpen = true)}
          >Show {rows.length - visibleRows.length} more</Button
        >
      {/if}
    </div>
  {:else}
    <div
      class="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground"
    >
      <p>No project selected.</p>
      <span>{emptyStateHint}</span>
    </div>
  {/if}
</NavigatorPanel>

<AlertDialog
  open={pendingDelete?.kind === "conversation"}
  title="Delete conversation?"
  description={pendingDelete
    ? `This permanently removes “${pendingDelete.label}”.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (pendingDelete?.kind === "conversation")
      onDeleteConversation?.(pendingDelete.id);
  }}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>

{#if activeProject}
  <ProjectConversationsDialog
    open={allConversationsOpen}
    projectLabel={activeProject.name}
    project={activeProject}
    {projectIds}
    {conversations}
    {agents}
    {selectedConversationId}
    {openConversationTabIds}
    {conversationActivityById}
    {onOpenConversation}
    buildMenu={(conversation) =>
      buildConversationMenu(
        projects.find((project) => project.id === conversation.projectId) ??
          activeProject,
        conversation,
        menuContext,
      )}
    onOpenChange={(open) => (allConversationsOpen = open)}
  />
{/if}
