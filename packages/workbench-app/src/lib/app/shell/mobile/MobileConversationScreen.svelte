<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import FileDiff from "@lucide/svelte/icons/file-diff";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  MobileActionSheet,
  MobileScreen,
  MobileSegmentedControl,
  type MobileSegment,
} from "$lib/presentation/shell";
import { ConversationCenterHost } from "$lib/app/composition/registries/center-view-registry";
import { tabIdentity, tabLabel } from "$lib/app/shell/editor-tab-helpers";
import {
  workspaceSelectors,
  type CenterTabIdentity,
} from "$lib/application/workspace";
import {
  conversationDraftStore,
  type PromptDraftTarget,
} from "$lib/application/workspace/conversation-draft-store";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";
import {
  mobileConversationSegment,
  setMobileConversationSegment,
  type MobileConversationSegment,
} from "./mobile-conversation-segment.svelte";
import MobileGitChangesBody from "./MobileGitChangesBody.svelte";
import MobilePullRequestsBody from "./MobilePullRequestsBody.svelte";
import type { MobileCenterIdentity } from "./mobile-routes";
import { backFromMobileScreen, pushMobileScreen } from "./mobile-shell.svelte";

/**
 * A conversation as a phone screen: a hub of Chat, Changes, Files and PR for
 * the conversation's project. The transcript and composer stay mounted while
 * another segment shows, so drafts and scroll survive switching; segments are
 * view state, not routes, and the choice is remembered per conversation for
 * the session.
 */
let {
  identity,
  visible,
}: {
  identity: MobileCenterIdentity;
  visible: boolean;
} = $props();

const COMMIT_PROMPT =
  "Review the uncommitted changes in this repository and commit them with clear commit messages. Group unrelated changes into separate commits.";

const tab = $derived(identity as CenterTabIdentity);
const key = $derived(`${identity.kind}:${identity.id}`);
const conversation = $derived(
  identity.kind === "conversation"
    ? workspaceSelectors.conversations.find(
        (candidate) => candidate.id === identity.id,
      )
    : undefined,
);
const tabModel = $derived(
  workspaceSelectors.centerTabs.find((candidate) => {
    const candidateIdentity = tabIdentity(candidate);
    return (
      candidateIdentity.kind === identity.kind &&
      candidateIdentity.id === identity.id
    );
  }),
);
const title = $derived(
  conversation?.title ?? (tabModel ? tabLabel(tabModel) : "New chat"),
);
const projectId = $derived(
  conversation?.projectId ?? workspaceSelectors.activeProject?.id,
);
const project = $derived(
  workspaceSelectors.projects.find((candidate) => candidate.id === projectId),
);
const menuItems = $derived(
  conversation ? mobileConversationMenu(conversation) : [],
);

const segment = $derived(mobileConversationSegment(key));
// Segments mount on first visit and stay mounted so scroll and state survive.
const visited = $state<Record<string, boolean>>({});
$effect(() => {
  visited[segment] = true;
});

const gitPanel = createWorkbenchGitPanelAdapter(
  () => project,
  () => visible,
  () => visible && segment === "pr",
);
const gitModel = $derived(gitPanel.model);
const summary = $derived(gitModel.repositorySummary);
const changedFiles = $derived(
  gitModel.changes?.files.length ?? summary?.changeCount,
);
const running = $derived(
  Boolean(
    identity.kind === "conversation" &&
    workspaceSelectors.conversationActivityById[identity.id]?.busy,
  ),
);
const subtitle = $derived(
  [project?.name, summary?.currentBranch ?? undefined]
    .filter(Boolean)
    .join(" · "),
);

const segments = $derived<MobileSegment[]>([
  { id: "chat", label: "Chat" },
  {
    id: "changes",
    label: "Changes",
    count: changedFiles,
    tone: changedFiles ? "warning" : undefined,
  },
  { id: "files", label: "Files" },
  { id: "pr", label: "PR" },
]);

let menuOpen = $state(false);

function select(id: string) {
  setMobileConversationSegment(key, id as MobileConversationSegment);
}

function openProject() {
  if (projectId) pushMobileScreen({ kind: "project", projectId });
}

/** Seeds the composer with a commit request; the user decides when to send. */
function askAgentToCommit() {
  const target: PromptDraftTarget | undefined =
    identity.kind === "conversation"
      ? { kind: "conversation", id: identity.id }
      : projectId
        ? { kind: "pending-conversation", id: identity.id, projectId }
        : undefined;
  if (target) {
    const drafts = conversationDraftStore();
    const existing = drafts.getPrompt(target).trimEnd();
    drafts.setPrompt(
      target,
      existing ? `${existing}\n\n${COMMIT_PROMPT}` : COMMIT_PROMPT,
    );
  }
  select("chat");
}

const panelClass = (id: string) =>
  segment === id ? "flex min-h-0 flex-1 flex-col" : "hidden";
</script>

<MobileScreen
  {title}
  {subtitle}
  onSubtitleSelect={projectId ? openProject : undefined}
  subtitleLabel={`Open ${project?.name ?? "project"}`}
  onBack={backFromMobileScreen}
  backLabel="Back"
  scroll={false}
>
  {#snippet actions()}
    {#if menuItems.length}
      <Button
        variant="ghost"
        size="icon"
        ariaLabel="Conversation actions"
        onclick={() => (menuOpen = true)}
      >
        <EllipsisVertical size={18} strokeWidth={1.9} />
      </Button>
    {/if}
  {/snippet}

  {#snippet below()}
    <MobileSegmentedControl
      items={segments}
      value={segment}
      label="Conversation views"
      onSelect={select}
    />
  {/snippet}

  <div class="flex min-h-0 flex-col">
    <div class={panelClass("chat")}>
      {#if segment === "chat" && changedFiles && !running}
        <button
          type="button"
          class="mx-3 mt-2 flex min-h-11 flex-none items-center gap-3 rounded-lg border border-border-subtle bg-card px-3 py-2 text-left shadow-sm active:bg-muted"
          onclick={() => select("changes")}
        >
          <span
            class="flex size-8 flex-none items-center justify-center rounded-md bg-warning-subtle text-warning"
          >
            <FileDiff size={16} />
          </span>
          <span class="grid min-w-0 flex-1">
            <span class="truncate text-ui text-foreground"
              >{changedFiles}
              {changedFiles === 1 ? "file" : "files"} changed</span
            >
            <span class="truncate text-caption text-muted-foreground"
              >Uncommitted</span
            >
          </span>
          <span class="flex-none text-ui text-primary">Review</span>
        </button>
      {/if}
      <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
        <ConversationCenterHost {tab} active={visible && segment === "chat"} />
      </div>
    </div>

    {#if visited.changes && projectId}
      <div class={panelClass("changes")}>
        <MobileGitChangesBody
          {projectId}
          model={gitModel}
          actions={gitPanel.actions}
          embedded
          onAskAgentToCommit={askAgentToCommit}
        />
      </div>
    {/if}
    {#if visited.files && projectId}
      <div class={panelClass("files")}>
        {#await import("$lib/app/composition/mobile/MobileFilesBody.svelte") then module}
          <module.default {projectId} path="" embedded />
        {/await}
      </div>
    {/if}
    {#if visited.pr}
      <div class={panelClass("pr")}>
        <MobilePullRequestsBody
          model={gitModel}
          actions={gitPanel.actions}
          embedded
        />
      </div>
    {/if}
  </div>
</MobileScreen>

{#if menuItems.length}
  <MobileActionSheet
    open={menuOpen}
    {title}
    items={menuItems}
    onOpenChange={(open) => (menuOpen = open)}
  />
{/if}
