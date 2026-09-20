<script lang="ts">
import GitBranch from "@lucide/svelte/icons/git-branch";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { panelViewDescriptors } from "$lib/app/composition/registries/panel-registry";
import { gitSelectors } from "$lib/features/git";
import { taskSelectors } from "$lib/features/tasks";
import { tildePath } from "$lib/domain/filesystem/project-path";
import { workspaceSelectors } from "$lib/application/workspace";
import { showMobilePanel, showMobileProjects } from "./mobile-shell.svelte";

let { prCount = 0 }: { prCount?: number } = $props();

/** Project hub: the dock panels as a reachable list instead of icon tabs. */
const activeProject = $derived(workspaceSelectors.activeProject);
const homeDir = $derived(workspaceSelectors.status?.storage.userHome);
const gitStatus = $derived(gitSelectors.gitStatus);
const runningTasks = $derived(
  taskSelectors.scopedTasks.filter((task) =>
    ["starting", "running", "ready", "stopping"].includes(task.status),
  ).length,
);

function descriptor(id: string) {
  return panelViewDescriptors.find((candidate) => candidate.id === id);
}

const repositoryRows = $derived([
  {
    id: "git",
    title: descriptor("git")?.title ?? "Git Changes",
    detail: gitStatus
      ? gitStatus.changeCount > 0
        ? `${gitStatus.changeCount} uncommitted ${gitStatus.changeCount === 1 ? "change" : "changes"}`
        : "Working tree clean"
      : "No repository",
    count: gitStatus?.changeCount ?? 0,
  },
  {
    id: "pull-requests",
    title: descriptor("pull-requests")?.title ?? "Pull Requests",
    detail: prCount > 0 ? `${prCount} open` : "No open pull requests",
    count: prCount,
  },
]);

const workspaceRows = $derived([
  { id: "files", detail: "Browse and open project files", count: 0 },
  {
    id: "tasks",
    detail: runningTasks > 0 ? `${runningTasks} running` : "No running tasks",
    count: runningTasks,
  },
  { id: "context", detail: "Context usage for this conversation", count: 0 },
  { id: "notes", detail: "Scratch notes for this project", count: 0 },
]);
</script>

<MobileScreen
  title={activeProject?.name ?? "Select a project"}
  subtitle={activeProject ? tildePath(activeProject.dir, homeDir) : undefined}
  onTitleSelect={showMobileProjects}
  titleLabel="Switch project"
>
  <MobileSection title="Repository" meta={gitStatus?.branch}>
    {#each repositoryRows as row (row.id)}
      <MobileListRow
        title={row.title}
        detail={row.detail}
        icon={row.id === "git" ? GitBranch : descriptor(row.id)?.icon}
        count={row.count}
        onclick={() => showMobilePanel(row.id)}
      />
    {/each}
  </MobileSection>

  <MobileSection title="Tools">
    {#each workspaceRows as row (row.id)}
      <MobileListRow
        title={descriptor(row.id)?.title ?? row.id}
        detail={row.detail}
        icon={descriptor(row.id)?.icon}
        count={row.count}
        onclick={() => showMobilePanel(row.id)}
      />
    {/each}
  </MobileSection>
</MobileScreen>
