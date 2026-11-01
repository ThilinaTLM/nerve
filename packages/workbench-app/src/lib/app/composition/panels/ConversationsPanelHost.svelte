<script lang="ts">
import { gitSelectors } from "$lib/features/git";
import ProjectConversationNavigator from "$lib/features/projects/views/ProjectConversationNavigator.svelte";
import { projectNavigatorSignals } from "$lib/features/projects/state/project-navigator-signals.svelte";
import {
  sidebarProjects,
  sidebarConversations,
  sidebarAgents,
  updateConversationStateAndRefresh,
  pruneProjectConversationsAndRefresh,
} from "$lib/features/projects/adapters/conversation-sidebar.adapter";
import { openProjectSettingsPane } from "$lib/application/settings";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { maintenance } from "$lib/application/maintenance/maintenance-state.svelte";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import {
  deleteConversationAndRefresh,
  deleteProjectAndRefresh,
  newConversationInProject,
} from "$lib/application/workspace/workspace-actions.svelte";

const status = $derived(workspaceSelectors.status);
const projectIds = $derived(new Set(workspaceSelectors.selectedProjectIds));
const projects = $derived(
  sidebarProjects(
    workspaceSelectors.projects.filter((project) => projectIds.has(project.id)),
  ),
);
const conversations = $derived(
  sidebarConversations(workspaceSelectors.selectedProjectConversations),
);
const agents = $derived(sidebarAgents(conversations));
const openConversationTabIds = $derived(
  workspaceSelectors.openConversationTabIds,
);
const conversationActivityById = $derived(
  workspaceSelectors.conversationActivityById,
);
</script>

<ProjectConversationNavigator
  {projects}
  {conversations}
  {agents}
  currentRepositories={Object.fromEntries(
    projects.map((project) => [
      project.id,
      gitSelectors.githubRepository(project.id),
    ]),
  )}
  homeDir={status?.storage.userHome}
  selectedProjectId={selection.projectId}
  selectedConversationId={selection.conversationId}
  {openConversationTabIds}
  {conversationActivityById}
  searchFocusToken={projectNavigatorSignals.searchFocusToken}
  maintenanceActive={maintenance.active}
  onOpenConversation={openConversation}
  onNewConversationInProject={newConversationInProject}
  onOpenProjectSettings={(projectId) => void openProjectSettingsPane(projectId)}
  onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
  onDeleteConversation={(id) => void deleteConversationAndRefresh(id)}
  onUpdateConversationState={(id, request) =>
    void updateConversationStateAndRefresh(id, request)}
  onPruneProjectConversations={(id, request) =>
    void pruneProjectConversationsAndRefresh(id, request)}
/>
