<script lang="ts">
import FolderTree from "@lucide/svelte/icons/folder-tree";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Play from "@lucide/svelte/icons/play";
import Settings from "@lucide/svelte/icons/settings";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import type { GitPanelModel } from "$lib/features/git";
import { gitSelectors } from "$lib/features/git";
import { launchSelectors } from "$lib/features/launches";
import { tildePath } from "$lib/domain/filesystem/project-path";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileNewChatFab from "./MobileNewChatFab.svelte";
import MobileRootActions from "./MobileRootActions.svelte";
import { LIVE_LAUNCH_STATUSES, launchesInProject } from "./mobile-activity";
import { mobileConversationRowActions } from "./mobile-conversation-swipe.svelte";
import { buildMobileProjectHome } from "./mobile-project-home";
import { openMobileConversation } from "./mobile-route-activation.svelte";
import { backFromMobileScreen, pushMobileScreen } from "./mobile-shell.svelte";

/**
 * A project's home on a phone, as a dashboard: repository status with tappable
 * stat tiles, the conversations worth reopening, then a tile per project tool.
 * Replaces the desktop docks.
 */
let { projectId, gitModel }: { projectId: string; gitModel: GitPanelModel } =
  $props();

const project = $derived(
  workspaceSelectors.projects.find((candidate) => candidate.id === projectId),
);
const projectIds = $derived(
  workspaceSelectors.projectSwitcherItems.find(
    (item) => item.project.id === projectId,
  )?.projectIds ?? [projectId],
);
const homeDir = $derived(workspaceSelectors.status?.storage.userHome);
// Git status and the git model follow the selected project, which route
// activation sets to this one while it is on screen.
const isActive = $derived(workspaceSelectors.activeProject?.id === projectId);
const gitStatus = $derived(isActive ? gitSelectors.gitStatus : undefined);

const model = $derived(
  buildMobileProjectHome({
    conversations: workspaceSelectors.conversations.filter((conversation) =>
      projectIds.includes(conversation.projectId),
    ),
    activityById: workspaceSelectors.conversationActivityById,
    liveLaunchCount: launchesInProject(
      launchSelectors.launches,
      workspaceSelectors.projects,
      projectId,
    ).filter((launch) => LIVE_LAUNCH_STATUSES.has(launch.status)).length,
    git: gitStatus
      ? {
          changeCount: gitStatus.changeCount,
          branch: gitStatus.branch,
          ahead: gitStatus.ahead,
          behind: gitStatus.behind,
          hasUpstream: gitStatus.hasUpstream,
          detached: gitStatus.detached,
        }
      : undefined,
    prCount: isActive ? gitModel.pullRequests.length : 0,
  }),
);
const activityById = $derived(workspaceSelectors.conversationActivityById);

const tools = $derived([
  {
    label: "Files",
    icon: FolderTree,
    live: false,
    open: () => pushMobileScreen({ kind: "files", projectId, path: "" }),
  },
  {
    label: "Launches",
    icon: SquareTerminal,
    live: model.liveLaunchCount > 0,
    open: () => pushMobileScreen({ kind: "launches", projectId }),
  },
  {
    label: "Notes",
    icon: NotebookPen,
    live: false,
    open: () => pushMobileScreen({ kind: "notes", projectId }),
  },
  {
    label: "Settings",
    icon: Settings,
    live: false,
    open: () => pushMobileScreen({ kind: "project-settings", projectId }),
  },
]);
</script>

{#snippet stat(args: {
  label: string;
  value: number;
  tinted: boolean;
  open: () => void;
})}
  <button
    type="button"
    class={[
      "grid min-h-14 content-center gap-0.5 rounded-lg p-2.5 text-left",
      args.tinted ? "bg-warning-subtle" : "bg-muted",
    ]}
    aria-label={`${args.value} ${args.label}`}
    onclick={args.open}
  >
    <span
      class={[
        "flex items-center gap-1 text-title font-medium tabular-nums",
        args.tinted ? "text-warning" : "text-foreground",
      ]}
    >
      {#if args.label === "Open PR"}
        <GitPullRequest
          size={16}
          strokeWidth={1.9}
          class={args.value ? "text-success" : "text-muted-foreground"}
        />
      {:else if args.label === "Running"}
        <Play
          size={16}
          strokeWidth={1.9}
          class={args.value ? "text-info" : "text-muted-foreground"}
        />
      {/if}
      {args.value}
    </span>
    <span class="text-caption text-muted-foreground">{args.label}</span>
  </button>
{/snippet}

<MobileNewChatFab {project}>
  <MobileScreen
    title={project?.name ?? "Project"}
    subtitle={project ? tildePath(project.directory, homeDir) : undefined}
    onBack={backFromMobileScreen}
    backLabel="Back to projects"
  >
    {#snippet actions()}
      <MobileRootActions />
    {/snippet}

    <div class="grid gap-3 px-3 pt-4 pb-2">
      <div
        class="grid gap-3 rounded-xl border border-border-subtle bg-card p-3.5"
      >
        <div class="flex items-center gap-2">
          <GitBranch
            size={16}
            strokeWidth={1.9}
            class="flex-none text-muted-foreground"
          />
          <span class="min-w-0 flex-1 truncate text-ui">
            {model.repo
              ? model.repo.branch
              : isActive
                ? "No repository"
                : "Repository"}
          </span>
          {#if model.repo?.sync}
            <span class="flex-none text-caption text-muted-foreground"
              >{model.repo.sync}</span
            >
          {/if}
        </div>
        <div class="grid grid-cols-3 gap-2">
          {@render stat({
            label: "Changed",
            value: model.changedCount,
            tinted: model.changedCount > 0,
            open: () => pushMobileScreen({ kind: "git", projectId }),
          })}
          {@render stat({
            label: "Open PR",
            value: model.prCount,
            tinted: false,
            open: () => pushMobileScreen({ kind: "pull-requests", projectId }),
          })}
          {@render stat({
            label: "Running",
            value: model.liveLaunchCount,
            tinted: false,
            open: () => pushMobileScreen({ kind: "launches", projectId }),
          })}
        </div>
      </div>
    </div>

    <MobileSection
      title="Conversations"
      action={{
        label: `All ${model.conversationCount}`,
        onclick: () => pushMobileScreen({ kind: "conversations", projectId }),
      }}
    >
      {#each model.recent as conversation (conversation.id)}
        {@const activity = activityById[conversation.id]}
        {@const actions = mobileConversationRowActions(conversation)}
        <MobileListRow
          title={conversation.title}
          meta={relativeTimeLabel(
            conversation.lastUserMessageAt ?? conversation.createdAt,
          )}
          detail={activity?.label}
          tone={activity?.tone ?? "neutral"}
          pulse={activity?.pulse ?? false}
          chevron={false}
          menuItems={actions.menuItems}
          swipeLeading={actions.swipeLeading}
          swipeTrailing={actions.swipeTrailing}
          onclick={() => void openMobileConversation(conversation.id)}
        />
      {:else}
        <p class="px-4 py-4 text-ui text-muted-foreground">
          No open conversations.
        </p>
      {/each}
    </MobileSection>

    <div class="grid grid-cols-4 gap-2 px-3 pt-2">
      {#each tools as tool (tool.label)}
        {@const ToolIcon = tool.icon}
        <button
          type="button"
          class="relative grid min-h-16 content-center justify-items-center gap-1.5 rounded-xl border border-border-subtle bg-card py-3"
          onclick={tool.open}
        >
          <ToolIcon size={20} strokeWidth={1.8} class="text-muted-foreground" />
          <span class="text-caption text-foreground">{tool.label}</span>
          {#if tool.live}
            <span
              class="absolute right-2 top-1.5 size-2 animate-pulse rounded-full bg-info"
              role="img"
              aria-label="Running"
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  </MobileScreen>
</MobileNewChatFab>
