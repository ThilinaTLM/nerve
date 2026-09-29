<script lang="ts">
import FolderTree from "@lucide/svelte/icons/folder-tree";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Terminal from "@lucide/svelte/icons/terminal";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import type { GitPanelModel } from "$lib/features/git";
import { gitSelectors } from "$lib/features/git";
import { taskSelectors } from "$lib/features/tasks";
import { tildePath } from "$lib/domain/filesystem/project-path";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileRootActions from "./MobileRootActions.svelte";
import { LIVE_TASK_STATUSES, taskProject } from "./mobile-activity";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";
import { buildMobileProjectHome } from "./mobile-project-home";
import { openMobileConversation } from "./mobile-route-activation.svelte";
import { backFromMobileScreen, pushMobileScreen } from "./mobile-shell.svelte";

/**
 * A project's home on a phone: the conversations worth reopening, then every
 * project tool as one row with a live summary. Replaces the desktop docks.
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
    liveTaskCount: taskSelectors.tasks.filter(
      (task) =>
        LIVE_TASK_STATUSES.has(task.status) &&
        project !== undefined &&
        taskProject(task, [project])?.id === projectId,
    ).length,
    git: gitStatus
      ? { changeCount: gitStatus.changeCount, branch: gitStatus.branch }
      : undefined,
    prCount: isActive ? gitModel.pullRequests.length : 0,
  }),
);
const activityById = $derived(workspaceSelectors.conversationActivityById);
</script>

<MobileScreen
  title={project?.name ?? "Project"}
  subtitle={project ? tildePath(project.dir, homeDir) : undefined}
  onBack={backFromMobileScreen}
  backLabel="Back to projects"
>
  {#snippet actions()}
    <MobileRootActions {project} />
  {/snippet}

  <MobileSection title="Conversations" meta={`${model.conversationCount}`}>
    {#each model.recent as conversation (conversation.id)}
      {@const activity = activityById[conversation.id]}
      <MobileListRow
        title={conversation.title}
        meta={relativeTimeLabel(
          conversation.lastUserMessageAt ?? conversation.createdAt,
        )}
        detail={activity?.label}
        tone={activity?.tone ?? "neutral"}
        pulse={activity?.pulse ?? false}
        menuItems={mobileConversationMenu(conversation)}
        onclick={() => void openMobileConversation(conversation.id)}
      />
    {/each}
    <MobileListRow
      title="All conversations"
      icon={MessagesSquare}
      count={model.conversationCount}
      onclick={() => pushMobileScreen({ kind: "conversations", projectId })}
    />
  </MobileSection>

  <MobileSection title="Workspace">
    <MobileListRow
      title="Files"
      detail="Browse and open project files"
      icon={FolderTree}
      onclick={() => pushMobileScreen({ kind: "files", projectId, path: "" })}
    />
    <MobileListRow
      title="Tasks"
      detail={model.tasksDetail}
      icon={Terminal}
      onclick={() => pushMobileScreen({ kind: "tasks", projectId })}
    />
    <MobileListRow
      title="Scratch notes"
      detail="Notes kept with this project"
      icon={NotebookPen}
      onclick={() => pushMobileScreen({ kind: "notes", projectId })}
    />
  </MobileSection>

  <MobileSection title="Repository" meta={gitStatus?.branch}>
    <MobileListRow
      title="Git changes"
      detail={model.gitDetail}
      icon={GitBranch}
      count={gitStatus?.changeCount ?? 0}
      onclick={() => pushMobileScreen({ kind: "git", projectId })}
    />
    <MobileListRow
      title="Pull requests"
      detail={model.pullRequestsDetail}
      icon={GitPullRequest}
      count={isActive ? gitModel.pullRequests.length : 0}
      onclick={() => pushMobileScreen({ kind: "pull-requests", projectId })}
    />
  </MobileSection>
</MobileScreen>
