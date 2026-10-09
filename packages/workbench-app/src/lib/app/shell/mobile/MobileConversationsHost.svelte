<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileSection,
  MobileScreen,
} from "$lib/presentation/shell";
import {
  buildConversationSections,
  conversationLastUserPromptAt,
} from "$lib/domain/projects/project-tree";
import { conversationListPreferences } from "$lib/features/projects";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";
import {
  openMobileConversation,
  startMobileConversation,
} from "./mobile-route-activation.svelte";
import { backFromMobileScreen } from "./mobile-shell.svelte";

/**
 * One project's full conversation list at phone scale: full-width rows with
 * the last prompt time, a status dot, and the same actions the desktop context
 * menu offers.
 */
let { projectId }: { projectId: string } = $props();

let query = $state("");

const project = $derived(
  workspaceSelectors.projects.find((candidate) => candidate.id === projectId),
);
const projectIds = $derived(
  workspaceSelectors.projectSwitcherItems.find(
    (item) => item.project.id === projectId,
  )?.projectIds ?? [projectId],
);
const conversations = $derived(
  workspaceSelectors.conversations.filter((conversation) =>
    projectIds.includes(conversation.projectId),
  ),
);
const activityById = $derived(workspaceSelectors.conversationActivityById);
const sections = $derived(
  buildConversationSections({
    conversations,
    projectIds,
    filter: query,
    hideCompleted: conversationListPreferences.hideCompleted,
  }),
);
const total = $derived(
  sections.reduce((count, section) => count + section.rows.length, 0),
);
</script>

<MobileScreen
  title="Conversations"
  subtitle={[
    project?.name,
    total === 1 ? "1 conversation" : `${total} conversations`,
  ]
    .filter(Boolean)
    .join(" · ")}
  onBack={backFromMobileScreen}
  backLabel="Back to project"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="New chat"
      disabled={!project}
      onclick={() => project && void startMobileConversation(project)}
    >
      <Plus size={18} strokeWidth={2.1} />
    </Button>
  {/snippet}

  <div class="px-3 pt-2">
    <SearchInput
      bind:value={query}
      placeholder="Search conversations"
      ariaLabel="Search conversations"
    />
  </div>

  {#each sections as section (section.key)}
    <MobileSection title={section.label} meta={`${section.rows.length}`}>
      {#each section.rows as row (row.conversation.id)}
        {@const activity = activityById[row.conversation.id]}
        <MobileListRow
          title={row.conversation.title}
          meta={relativeTimeLabel(
            conversationLastUserPromptAt(row.conversation),
          )}
          detail={activity?.label}
          tone={activity?.tone ?? "neutral"}
          pulse={activity?.pulse ?? false}
          selected={selection.conversationId === row.conversation.id}
          menuItems={mobileConversationMenu(row.conversation)}
          onclick={() => void openMobileConversation(row.conversation.id)}
        />
      {/each}
    </MobileSection>
  {/each}

  {#if total === 0}
    <p class="px-6 py-12 text-center text-sm text-muted-foreground">
      {query.trim()
        ? "No conversations match your search."
        : "No conversations in this project yet."}
    </p>
  {/if}
</MobileScreen>
