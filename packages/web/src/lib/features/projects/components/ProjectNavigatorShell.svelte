<script lang="ts">
  import ProjectAgentTree from "$lib/features/projects/components/ProjectAgentTree.svelte";
  import { workbenchUiState } from "$lib/app/state/workbench-ui-state.svelte";
  import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
  import { selection } from "$lib/features/workspace/state/selection.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import { openConversation } from "$lib/features/conversations/state/conversation-flow/tabs";
  import {
    deleteConversationAndRefresh,
    deleteProjectAndRefresh,
    newConversationInProject,
    openProjectInEditorAndNotify,
    pruneProjectConversationsAndRefresh,
  } from "$lib/features/workspace/state/workspace-actions.svelte";

  const status = $derived(workspaceSelectors.status);
  const projects = $derived(workspaceSelectors.projects);
  const conversations = $derived(workspaceSelectors.conversations);
  const agents = $derived(workspaceSelectors.agents);
  const openConversationTabIds = $derived(
    workspaceSelectors.openConversationTabIds,
  );
  const conversationActivityById = $derived(
    conversationSelectors.conversationActivityById,
  );
</script>

<ProjectAgentTree
  {projects}
  {conversations}
  {agents}
  homeDir={status?.storage.home}
  selectedProjectId={selection.projectId}
  selectedConversationId={selection.conversationId}
  {openConversationTabIds}
  {conversationActivityById}
  searchFocusToken={workbenchUiState.projectSearchFocusToken}
  editorAvailability={status?.runtime.editors}
  onOpenConversation={openConversation}
  onNewConversationInProject={newConversationInProject}
  onOpenProjectInEditor={(projectId, editor) =>
    void openProjectInEditorAndNotify(projectId, editor)}
  onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
  onDeleteConversation={(id) => void deleteConversationAndRefresh(id)}
  onPruneProjectConversations={(id, request) =>
    void pruneProjectConversationsAndRefresh(id, request)}
/>
