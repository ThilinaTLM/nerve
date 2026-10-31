<script lang="ts">
import { tick, untrack } from "svelte";
import type { ConversationRow } from "$lib/domain/projects/project-tree";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Plus from "@lucide/svelte/icons/plus";
import Pin from "@lucide/svelte/icons/pin";
import Settings from "@lucide/svelte/icons/settings";
import type { ProjectRecord } from "$lib/domain/projects/sidebar-view-models";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panels";
import {
  buildConversationSections,
  limitConversationSections,
} from "$lib/presentation/conversations/conversation-list";
import { buildConversationRows } from "$lib/domain/projects/project-tree";
import {
  matchConversationReference,
  referenceRepositoryLabels,
} from "$lib/presentation/conversations/conversation-references";
import { searchConversations } from "$lib/presentation/conversations/conversation-search";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import ProjectAgentTreeNode from "./ProjectAgentTreeNode.svelte";
import ConversationListSettingsDialog from "./ConversationListSettingsDialog.svelte";
import PruneConversationsDialog from "./PruneConversationsDialog.svelte";
import { getShortcutLabel } from "$lib/application/commands/command-registry";
import {
  buildConversationMenu,
  countAgeEligible,
  countCompletedEligible,
  countKeepEligible,
  countProjectConversations,
  type ProjectTreeMenuContext,
} from "./project-tree-menus";
import type {
  DeleteTarget,
  ProjectAgentTreeProps,
} from "./project-agent-tree-props";
import {
  conversationListPreferences,
  setHideCompletedConversations,
} from "$lib/features/projects/state/conversation-list-preferences.svelte";

let {
  currentRepositories = {},
  projects = [],
  conversations = [],
  agents = [],
  selectedProjectId,
  selectedConversationId,
  openConversationTabIds,
  conversationActivityById = {},
  searchFocusToken = 0,
  maintenanceActive = false,
  homeDir,
  onOpenConversation,
  onNewConversationInProject,
  onOpenProjectSettings,
  onDeleteProject,
  onDeleteConversation,
  onUpdateConversationState,
  onPruneProjectConversations,
}: ProjectAgentTreeProps = $props();

const MAX_LISTED_CONVERSATIONS = 100;

let pendingDelete = $state<DeleteTarget | undefined>();
let search = $state("");
let searchInput = $state<HTMLInputElement | null>(null);
let settingsOpen = $state(false);
let cleanUpOpen = $state(false);

const activeProject = $derived(
  projects.find((project) => project.id === selectedProjectId) ?? projects[0],
);
const projectIds = $derived(projects.map((project) => project.id));
const allRows = $derived(
  buildConversationRows({ conversations, agents, projectIds }),
);
const searching = $derived(Boolean(search.trim()));
const repoLabels = $derived(
  referenceRepositoryLabels(
    allRows.flatMap((row) => row.conversation.references),
  ),
);
const searchHits = $derived(
  searchConversations(allRows, search, {
    activityById: conversationActivityById,
    matchField: (row, term) =>
      matchConversationReference(row.conversation.references, term, repoLabels),
  }),
);
const sections = $derived(
  buildConversationSections({
    rows: allRows,
    activityById: conversationActivityById,
    hideCompleted: conversationListPreferences.hideCompleted,
  }),
);
const rowCount = $derived(
  searching
    ? searchHits.length
    : sections.reduce((count, section) => count + section.rows.length, 0),
);
const liveSections = $derived(
  searching
    ? [
        {
          key: "results",
          label: "Results",
          rows: searchHits
            .slice(0, MAX_LISTED_CONVERSATIONS)
            .map((hit) => hit.row),
        },
      ]
    : limitConversationSections(sections, MAX_LISTED_CONVERSATIONS),
);
let menuSections = $state<
  { key: string; label: string; rows: ConversationRow[] }[] | undefined
>();
const displayedSections = $derived(menuSections ?? liveSections);
let viewport = $state<HTMLDivElement>();
// Section changes recreate a row's DOM. Preserve its viewport offset and keyboard focus.
$effect.pre(() => {
  const next = displayedSections;
  untrack(() => {
    if (!viewport) return;
    const focused =
      document.activeElement instanceof HTMLElement &&
      viewport.contains(document.activeElement)
        ? document.activeElement.closest<HTMLElement>("[data-panel-row-id]")
        : null;
    const anchor =
      focused ??
      [...viewport.querySelectorAll<HTMLElement>("[data-panel-row-id]")].find(
        (row) =>
          row.getBoundingClientRect().bottom >=
          viewport!.getBoundingClientRect().top,
      );
    const id = anchor?.dataset.panelRowId;
    if (
      !anchor ||
      !id ||
      !next.some((section) =>
        section.rows.some((row) => row.conversation.id === id),
      )
    )
      return;
    const top = anchor.getBoundingClientRect().top;
    void tick().then(() => {
      const replacement = viewport?.querySelector<HTMLElement>(
        `[data-panel-row-id="${CSS.escape(id)}"]`,
      );
      if (!replacement || !viewport) return;
      viewport.scrollTop += replacement.getBoundingClientRect().top - top;
      if (focused && document.activeElement === document.body)
        replacement.querySelector("button")?.focus({ preventScroll: true });
    });
  });
});
const matchedReferences = $derived(
  new Map(searchHits.map((hit) => [hit.row.conversation.id, hit.referenceKey])),
);
const highlights = $derived(
  new Map(searchHits.map((hit) => [hit.row.conversation.id, hit.titleIndexes])),
);

const hasProjectConversations = $derived(
  conversations.some((conversation) =>
    projectIds.includes(conversation.projectId),
  ),
);
const newConversationShortcut = getShortcutLabel("conversation.new");
const switchProjectShortcut = getShortcutLabel("conversation.newFromProject");
const emptyStateHint = switchProjectShortcut
  ? `Use the folder button in the header (${switchProjectShortcut}) to get started.`
  : "Use the folder button in the header to get started.";

let lastSearchFocusToken = 0;
$effect(() => {
  if (searchFocusToken === lastSearchFocusToken || !searchInput) return;
  lastSearchFocusToken = searchFocusToken;
  searchInput?.focus();
});

const menuContext = $derived<ProjectTreeMenuContext>({
  homeDir,
  newConversationShortcut,
  conversationCount: (projectId) =>
    conversations.filter((conversation) => conversation.projectId === projectId)
      .length,
  maintenanceActive,
  onOpenConversation,
  conversationActivity: (conversationId) =>
    conversationActivityById[conversationId],
  onUpdateConversationState,
  onNewConversationInProject,
  onOpenProjectSettings,
  requestPrune: (project: ProjectRecord) =>
    onPruneProjectConversations?.(project.id, {
      strategy: "keepLatest",
      keepLatest: 20,
    }),
  requestDelete: (target) => (pendingDelete = target),
});
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <PanelView>
    <PanelHeader title="Conversations" count={rowCount}>
      {#snippet trailing()}
        <PanelToolbarButton
          icon={Settings}
          label="Conversation settings"
          onclick={() => (settingsOpen = true)}
        />
        <span class="inline-flex" data-tour-id="panel-new-conversation">
          <PanelToolbarButton
            icon={Plus}
            label="New chat"
            title={newConversationShortcut
              ? `New chat (${newConversationShortcut})`
              : "New chat"}
            disabled={!activeProject || !onNewConversationInProject}
            onclick={() => {
              if (activeProject)
                onNewConversationInProject?.(activeProject.dir);
            }}
          />
        </span>
      {/snippet}
    </PanelHeader>

    <div class="shrink-0 pb-1.5">
      <SearchInput
        bind:value={search}
        bind:ref={searchInput}
        ariaLabel="Search conversations"
        placeholder="Search conversations"
        onkeydown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            search = "";
          }
        }}
      />
    </div>

    {#if !activeProject}
      <PanelEmpty title="No project selected." description={emptyStateHint} />
    {:else if rowCount === 0}
      <PanelEmpty
        icon={MessagesSquare}
        title={searching
          ? "No matches"
          : hasProjectConversations
            ? "Everything is done"
            : "No conversations yet"}
        description={searching
          ? "Try a status, PR number, or part of a title."
          : hasProjectConversations
            ? "Search “done” to find them."
            : "Conversations are scoped to this project."}
      >
        {#snippet action()}
          <Button
            variant="outline"
            size="sm"
            onclick={() => onNewConversationInProject?.(activeProject.dir)}
          >
            <Plus />
            New chat
          </Button>
        {/snippet}
      </PanelEmpty>
    {:else}
      <ScrollRegion
        bind:viewport
        ariaLabel="Conversations"
        topShadowClass="top-0 h-2"
        contentClass="pb-2"
      >
        {#each displayedSections as section (section.key)}
          <div
            class="flex items-center gap-1.5 px-1 pt-3 pb-1 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground"
          >
            {#if section.key === "pinned"}<Pin
                class="size-3"
                aria-hidden="true"
              />{/if}
            {section.label}<span class="font-normal text-muted-foreground/70"
              >{searching
                ? searchHits.length
                : (sections.find((candidate) => candidate.key === section.key)
                    ?.rows.length ?? section.rows.length)}</span
            >
          </div>
          <PanelList
            ariaLabel={`${section.label} conversations`}
            class="shrink-0 overflow-hidden rounded-md bg-background/60 py-0"
          >
            {#each section.rows as row (row.conversation.id)}
              {@const rowProject =
                projects.find(
                  (project) => project.id === row.conversation.projectId,
                ) ?? activeProject}
              <ProjectAgentTreeNode
                {row}
                {repoLabels}
                currentRepository={currentRepositories[
                  row.conversation.projectId
                ]}
                matchedReference={searching
                  ? matchedReferences.get(row.conversation.id)
                  : undefined}
                onMenuOpenChange={(open) => {
                  menuSections = open ? displayedSections : undefined;
                }}
                highlight={searching
                  ? highlights.get(row.conversation.id)
                  : undefined}
                faded={section.key === "previous-7-days" ||
                  section.key === "older"}
                isActive={row.conversation.id === selectedConversationId}
                isOpen={openConversationTabIds?.has(row.conversation.id) ??
                  false}
                activity={conversationActivityById[row.conversation.id]}
                menuItems={buildConversationMenu(
                  rowProject,
                  row.conversation,
                  menuContext,
                )}
                {onOpenConversation}
              />
            {/each}
          </PanelList>
        {/each}
      </ScrollRegion>
    {/if}
  </PanelView>
</Tooltip.Provider>
<ConversationListSettingsDialog
  bind:open={settingsOpen}
  hideCompleted={conversationListPreferences.hideCompleted}
  cleanUpDisabled={maintenanceActive ||
    !activeProject ||
    countProjectConversations(conversations, activeProject.id) === 0}
  onHideCompletedChange={setHideCompletedConversations}
  onCleanUp={() => (cleanUpOpen = true)}
/>

{#if activeProject}
  <PruneConversationsDialog
    bind:open={cleanUpOpen}
    projectLabel={activeProject.name}
    totalCount={countProjectConversations(conversations, activeProject.id)}
    ageEligible={(days) =>
      countAgeEligible(conversations, activeProject.id, days)}
    keepEligible={(keep) =>
      countKeepEligible(conversations, activeProject.id, keep)}
    completedEligible={() =>
      countCompletedEligible(conversations, activeProject.id)}
    disabled={maintenanceActive}
    onConfirm={(request) => {
      if (!maintenanceActive)
        onPruneProjectConversations?.(activeProject.id, request);
    }}
  />
{/if}

<AlertDialog
  open={pendingDelete?.kind === "project"}
  title="Remove project?"
  description={pendingDelete
    ? `This removes “${pendingDelete.label}” from Nerve and deletes its Nerve conversations. Files on disk are not deleted.`
    : ""}
  confirmLabel="Remove"
  destructive
  onConfirm={() => {
    if (pendingDelete?.kind === "project" && !maintenanceActive)
      onDeleteProject?.(pendingDelete.id);
  }}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>

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
