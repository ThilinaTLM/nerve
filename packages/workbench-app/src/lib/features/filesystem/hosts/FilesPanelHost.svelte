<script lang="ts">
import type { Project } from "@nervekit/contracts/core";
import type { ProjectEditor, StatusResponse } from "$lib/api";
import { listedNames } from "$lib/features/filesystem/state/file-explorer-operations.svelte";
import { FilesTreeController } from "$lib/features/filesystem/state/files-tree-controller.svelte";
import {
  filesPanelPreferences,
  setFilesPanelPreference,
} from "$lib/features/filesystem/state/files-panel-preferences.svelte";
import { quickOpen } from "$lib/features/filesystem/quick-open/quick-open-controller.svelte";
import FilesPanel from "../views/FilesPanel.svelte";

let {
  activeProject,
  editorAvailability,
  terminalAvailability,
  onOpenInEditor,
  onOpenInTerminal,
}: {
  activeProject?: Project;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  terminalAvailability?: StatusResponse["runtime"]["terminal"];
  onOpenInEditor?: (
    projectId: string,
    editor: ProjectEditor,
    path?: string,
  ) => void;
  onOpenInTerminal?: (projectId: string, path?: string) => void;
} = $props();

const tree = new FilesTreeController({
  activeProject: () => activeProject,
  editorAvailability: () => editorAvailability,
  terminalAvailability: () => terminalAvailability,
  onOpenInEditor: () => onOpenInEditor,
  onOpenInTerminal: () => onOpenInTerminal,
});
const drag = tree.drag;

$effect(() => tree.startProject());
$effect(() => tree.pruneToVisible());
$effect(() => tree.followActiveFile());
$effect(() => tree.handleRevealRequest());
</script>

<FilesPanel
  projectName={activeProject?.name}
  root={tree.root}
  nodes={tree.nodes}
  expandedIds={tree.treeExpandedIds}
  busy={tree.busy}
  statusIssues={tree.statusIssues}
  isEntryOpen={tree.isEntryOpen}
  selectedPaths={tree.selectedPaths}
  cutPaths={tree.cutPaths}
  gitDecorations={tree.gitDecorations}
  preferences={filesPanelPreferences}
  bind:filterOpen={tree.filterOpen}
  bind:filterText={tree.filterText}
  renamingPath={tree.editing?.mode === "rename"
    ? tree.editing.entry.path
    : undefined}
  siblingNames={(directory) =>
    activeProject ? listedNames(activeProject.id, directory) : new Set()}
  rootMenu={tree.rootMenu}
  itemMenu={tree.itemMenu}
  dropTargetPath={drag.dropTargetPath}
  rootDropActive={drag.rootDropActive}
  externalDropHint={drag.externalDropHint}
  pendingDelete={tree.pendingDelete}
  deleteDescription={tree.deleteDescription}
  deleteLabel={tree.deleteMethod === "trash" ? "Move to Trash" : "Delete"}
  pendingReplace={drag.pendingReplace?.message}
  bind:treeController={tree.treeController}
  onPreferenceChange={setFilesPanelPreference}
  onQuickOpen={() => quickOpen.show(activeProject?.id)}
  onCollapseAll={tree.collapseAll}
  onRefresh={tree.requestRefresh}
  onRetry={tree.retryRoot}
  onRetryStatus={tree.retryStatus}
  onActivate={tree.activate}
  onExpansionChange={tree.setExpanded}
  onItemClick={tree.handleItemClick}
  onItemKeydown={tree.handleItemKeydown}
  onDragStart={drag.start}
  onDragEnd={drag.clear}
  onItemDragEnter={drag.itemOver}
  onItemDragOver={drag.itemOver}
  onItemDragLeave={() => undefined}
  onItemDrop={drag.itemDrop}
  onRootDragOver={drag.rootOver}
  onRootDragLeave={drag.rootLeave}
  onRootDrop={(event) => void drag.drop(event, "")}
  onCommitEdit={(item, name) => void tree.commitEdit(item, name)}
  onCancelEdit={tree.cancelEdit}
  onConfirmDelete={() => void tree.confirmDelete()}
  onCancelDelete={tree.cancelDelete}
  onConfirmReplace={drag.confirmReplace}
  onCancelReplace={drag.cancelReplace}
/>
