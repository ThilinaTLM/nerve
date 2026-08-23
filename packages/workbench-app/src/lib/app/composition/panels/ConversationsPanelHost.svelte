<script lang="ts">
import ProjectConversationNavigator from "$lib/features/projects/components/ProjectConversationNavigator.svelte";
import { projectNavigatorSignals } from "$lib/features/projects/state/project-navigator-signals.svelte";
import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { openConversation } from "$lib/features/conversations/state/tabs";
import {
  deleteConversationAndRefresh,
  deleteProjectAndRefresh,
  newConversationInProject,
  openProjectInEditorAndNotify,
  openProjectInTerminalAndNotify,
  pruneProjectConversationsAndRefresh,
  updateConversationStateAndRefresh,
} from "$lib/application/workspace/workspace-actions.svelte";

const status = $derived(workspaceSelectors.status);
const projectIds = $derived(new Set(workspaceSelectors.selectedProjectIds));
const projects = $derived(
  workspaceSelectors.projects.filter((project) => projectIds.has(project.id)),
);
const conversations = $derived(workspaceSelectors.selectedProjectConversations);
const agents = $derived(workspaceSelectors.agents);
const openConversationTabIds = $derived(
  workspaceSelectors.openConversationTabIds,
);
const conversationActivityById = $derived(
  conversationSelectors.conversationActivityById,
);
</script>

<ProjectConversationNavigator
  {projects}
  {conversations}
  {agents}
  homeDir={status?.storage.userHome}
  selectedProjectId={selection.projectId}
  selectedConversationId={selection.conversationId}
  {openConversationTabIds}
  {conversationActivityById}
  searchFocusToken={projectNavigatorSignals.searchFocusToken}
  editorAvailability={status?.runtime.editors}
  terminalAvailability={status?.runtime.terminal}
  onOpenConversation={openConversation}
  onNewConversationInProject={newConversationInProject}
  onOpenProjectInEditor={(projectId, editor) =>
    void openProjectInEditorAndNotify(projectId, editor)}
  onOpenProjectInTerminal={(projectId) =>
    void openProjectInTerminalAndNotify(projectId)}
  onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
  onDeleteConversation={(id) => void deleteConversationAndRefresh(id)}
  onUpdateConversationState={(id, request) =>
    void updateConversationStateAndRefresh(id, request)}
  onPruneProjectConversations={(id, request) =>
    void pruneProjectConversationsAndRefresh(id, request)}
/>
