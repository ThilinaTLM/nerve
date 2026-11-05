<script lang="ts" module>
/** Last reveal request this module handled, so remounting never replays it. */
let handledRevealToken = 0;
</script>

<script lang="ts">
import type { Project } from "@nervekit/contracts/core";
import { tick, untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { ProjectEditor, StatusResponse } from "$lib/api";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import type { GitProjectFileStatus } from "@nervekit/contracts/git";
import { getProjectGitFileStatus } from "$lib/api";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  desktopRuntime,
  getDesktopBridge,
} from "$lib/platform/desktop/desktop-bridge.svelte";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  activateFileExplorerItem,
  collapseAllFileExplorerItems,
  ensureFileExplorerRoot,
  monitoredFileExplorerDirectories,
  refreshFileExplorerProject,
  revealFileExplorerPath,
  setFileExplorerItemExpanded,
} from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import {
  startFilePanelController,
  type FilePanelController,
} from "$lib/features/filesystem/state/file-panel-controller.svelte";
import {
  fileExplorerRevealRequest,
  fileExplorerState,
} from "$lib/features/filesystem/state/file-explorer-state.svelte";
import {
  buildFileExplorerTreeView,
  fileExplorerEntryNodeId,
  type FileExplorerEntryItem,
  type FileExplorerTreeItem,
} from "$lib/features/filesystem/state/file-explorer-tree";
import {
  copyFileExplorerEntries,
  createFileExplorerEntry,
  deleteFileExplorerEntries,
  listedNames,
  moveFileExplorerEntries,
  planCopyNames,
  type DeleteMethod,
  type FileOperationContext,
} from "$lib/features/filesystem/state/file-explorer-operations.svelte";
import {
  joinPath,
  parentPath,
  planDrop,
  topLevelPaths,
} from "$lib/features/filesystem/state/file-explorer-paths";
import {} from "$lib/features/filesystem/state/file-explorer-drop";
import {
  emptyFileExplorerSelection,
  pruneSelection,
  selectOnly,
  selectRange,
  toggleSelected,
  type FileExplorerSelection,
} from "$lib/features/filesystem/state/file-explorer-selection";
import { describeFileOperationError } from "$lib/features/filesystem/state/file-operation-errors";
import {
  filesPanelPreferences,
  setFilesPanelPreference,
} from "$lib/features/filesystem/state/files-panel-preferences.svelte";
import { indexFileTreeGitDecorations } from "$lib/features/filesystem/state/file-git-status";
import {
  describeGitStatusErrors,
  describeGitStatusFailure,
} from "$lib/features/filesystem/state/file-panel-status";
import { quickOpen } from "$lib/features/filesystem/quick-open/quick-open-controller.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { requestComposerMentions } from "$lib/application/composer/composer-mention-requests.svelte";
import {
  errorDetails,
  showCriticalError,
} from "$lib/application/notifications/critical-errors.svelte";
import {
  formatProjectEntryReference,
  type ProjectEntryDragItem,
} from "$lib/presentation/dnd/project-entry-drag";
import {
  visiblePanelTreeRows,
  type PanelTreeController,
} from "$lib/presentation/panels";
import {
  buildFilesItemMenu,
  buildFilesRootMenu,
  type FilesContextMenuContext,
} from "$lib/features/filesystem/state/files-context-menu";
import { FilesTreeDrag } from "$lib/features/filesystem/state/files-tree-drag.svelte";
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

const noExpandedIds: ReadonlySet<string> = new Set();

type Editing =
  | { mode: "create"; parentPath: string; kind: "file" | "directory" }
  | { mode: "rename"; entry: FilesystemProjectEntry };

let gitFiles = $state<GitProjectFileStatus[]>([]);
let gitIssue = $state<string>();
let monitorIssue = $state<string>();
let selection = $state<FileExplorerSelection>(emptyFileExplorerSelection);
let editing = $state<Editing>();
let clipboard = $state<{
  mode: "cut" | "copy";
  entries: ProjectEntryDragItem[];
}>();
let filterOpen = $state(false);
let filterText = $state("");
let pendingDelete = $state<FilesystemProjectEntry[]>();
let treeController = $state<PanelTreeController>();

const project = $derived(
  activeProject ? fileExplorerState.projects[activeProject.id] : undefined,
);
const root = $derived(project?.directories[""]);
const treeView = $derived(
  project
    ? buildFileExplorerTreeView(project, {
        hideIgnored: filesPanelPreferences.hideIgnored,
        hideDotfiles: !filesPanelPreferences.showDotfiles,
        filter: filterText,
        creating:
          editing?.mode === "create"
            ? { parentPath: editing.parentPath, kind: editing.kind }
            : undefined,
      })
    : { nodes: [], filterExpandedIds: noExpandedIds },
);
const nodes = $derived(treeView.nodes);
const treeExpandedIds = $derived.by<ReadonlySet<string>>(() => {
  const base = project?.expandedIds ?? noExpandedIds;
  return treeView.filterExpandedIds.size > 0
    ? new Set([...base, ...treeView.filterExpandedIds])
    : base;
});
const visibleEntries = $derived(
  visiblePanelTreeRows(nodes, treeExpandedIds).flatMap((row) =>
    row.node.kind === "item" && row.node.value.type === "entry"
      ? [row.node.value.entry]
      : [],
  ),
);
const visiblePaths = $derived(visibleEntries.map((entry) => entry.path));
const gitDecorations = $derived(indexFileTreeGitDecorations(gitFiles));
const activeFile = $derived(fileSelectors.activeCenterFileView);
const activeRelativePath = $derived.by(() => {
  const file = activeFile;
  if (!file || file.projectId !== activeProject?.id) return undefined;
  return file.content?.relativePath ?? file.path;
});
/** The multi-selection, or the active editor file while nothing is selected. */
const selectedPaths = $derived<ReadonlySet<string>>(
  selection.ids.size > 0
    ? selection.ids
    : activeRelativePath
      ? new Set([activeRelativePath])
      : new Set<string>(),
);
const cutPaths = $derived<ReadonlySet<string>>(
  clipboard?.mode === "cut"
    ? new Set(clipboard.entries.map((entry) => entry.path))
    : new Set<string>(),
);
const rootEntry = $derived<FilesystemProjectEntry | undefined>(
  activeProject
    ? {
        name: activeProject.name,
        path: "",
        kind: "directory",
        symlink: false,
      }
    : undefined,
);
const statusIssues = $derived(
  [monitorIssue, gitIssue].filter((issue) => issue !== undefined),
);
const busy = $derived(
  Object.values(project?.directories ?? {}).some(
    (directory) => directory.loading || directory.refreshing,
  ),
);
const deleteMethod = $derived<DeleteMethod>(
  desktopRuntime.isDesktop ? "trash" : "delete",
);
const deleteDescription = $derived.by(() => {
  const entries = pendingDelete;
  if (!entries?.length) return undefined;
  const subject =
    entries.length === 1 ? `“${entries[0]?.name}”` : `${entries.length} items`;
  return deleteMethod === "trash"
    ? `${subject} will be moved to the operating-system trash and may be recoverable there.`
    : `${subject} will be permanently deleted. This cannot be undone.`;
});

const operationContext = $derived<FileOperationContext | undefined>(
  activeProject
    ? {
        projectId: activeProject.id,
        refresh: refreshDirectories,
        syncMonitorDemand,
      }
    : undefined,
);

function syncMonitorDemand(): void {
  if (activeProject)
    void fileController?.updateMonitorDemand(
      monitoredFileExplorerDirectories(activeProject.id),
    );
}

/** Refreshes watched directories now and marks cached, collapsed ones stale. */
async function refreshDirectories(directories: string[]): Promise<void> {
  const projectId = activeProject?.id;
  if (!projectId) return;
  const monitored = new Set(monitoredFileExplorerDirectories(projectId));
  const state = fileExplorerState.projects[projectId];
  for (const path of directories) {
    const directory = state?.directories[path];
    if (directory && !monitored.has(path)) directory.stale = true;
  }
  await Promise.all([
    refreshFileExplorerProject(projectId, directories),
    refreshGitStatus(projectId),
  ]);
}

function findEntry(path: string): FilesystemProjectEntry | undefined {
  return project?.directories[parentPath(path)]?.entries.find(
    (entry) => entry.path === path,
  );
}

function nodeId(path: string): string {
  return fileExplorerEntryNodeId(activeProject?.id ?? "", path);
}

function dragItem(entry: FilesystemProjectEntry): ProjectEntryDragItem[] {
  return entry.kind === "file" || entry.kind === "directory"
    ? [{ path: entry.path, kind: entry.kind }]
    : [];
}

/** The entries an action on `entry` applies to: the selection when it is in it. */
function actionTargets(
  entry: FilesystemProjectEntry,
): FilesystemProjectEntry[] {
  if (selection.ids.has(entry.path) && selection.ids.size > 1) {
    const entries = topLevelPaths([...selection.ids]).flatMap((path) => {
      const found = findEntry(path);
      return found ? [found] : [];
    });
    if (entries.length > 0) return entries;
  }
  return [entry];
}

function activate(item: FileExplorerTreeItem): void {
  if (!activeProject) return;
  if (item.type === "entry" && item.entry.kind === "file") {
    void openFilePane({ projectId: activeProject.id, path: item.entry.path });
    return;
  }
  activateFileExplorerItem(activeProject.id, item);
}

/** Expansion changes monitor demand, so every expand/collapse path goes through here. */
function setExpanded(item: FileExplorerTreeItem, expanded: boolean): void {
  if (!activeProject) return;
  setFileExplorerItemExpanded(activeProject.id, item, expanded);
  syncMonitorDemand();
}

function openFromMenu(item: FileExplorerEntryItem): void {
  if (!activeProject || !project) return;
  if (item.entry.kind === "file") {
    void openFilePane({ projectId: activeProject.id, path: item.entry.path });
    return;
  }
  if (item.entry.kind === "directory") {
    const id = fileExplorerEntryNodeId(activeProject.id, item.entry.path);
    setExpanded(item, !project.expandedIds.has(id));
  }
}

function collapseAll(): void {
  if (!activeProject) return;
  collapseAllFileExplorerItems(activeProject.id);
  syncMonitorDemand();
}

async function refreshGitStatus(
  projectId: string,
  followup = false,
): Promise<void> {
  try {
    const response = await getProjectGitFileStatus(projectId);
    if (activeProject?.id !== projectId) return;
    gitFiles = response.files;
    gitIssue = describeGitStatusErrors(response.errors);
    // A stale read crossed a monitor poll; re-read once, without retrying further.
    if (response.stale && !followup) await refreshGitStatus(projectId, true);
  } catch (caught) {
    // Decorations are best effort: keep the last status but say it may be outdated.
    if (activeProject?.id === projectId)
      gitIssue = describeGitStatusFailure(caught);
  }
}

async function refreshAll(
  projectId: string,
  directories?: readonly string[],
): Promise<void> {
  await Promise.all([
    refreshFileExplorerProject(projectId, directories),
    refreshGitStatus(projectId),
  ]);
}

async function copyText(text: string, label: string): Promise<void> {
  try {
    await writeClipboardText(text);
    notify.success(`Copied ${label}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

async function runNativeAction(
  action: "openProjectEntry" | "revealProjectEntry",
  entry: FilesystemProjectEntry,
): Promise<void> {
  if (!activeProject) return;
  const bridge = getDesktopBridge();
  if (!bridge) return;
  try {
    await bridge.files[action]({
      projectId: activeProject.id,
      relativePath: entry.path,
    });
  } catch (caught) {
    showCriticalError(
      action === "openProjectEntry"
        ? "Could not open project entry"
        : "Could not reveal project entry",
      errorDetails(caught),
    );
  }
}

// ----- Inline create and rename ------------------------------------------

async function focusRow(path: string): Promise<void> {
  await tick();
  await treeController?.revealRow(nodeId(path));
}

function requestCreate(
  kind: "file" | "directory",
  parent: FilesystemProjectEntry,
): void {
  if (!activeProject) return;
  filterText = "";
  if (parent.path) setExpanded({ type: "entry", entry: parent }, true);
  editing = { mode: "create", parentPath: parent.path, kind };
  void tick().then(() =>
    treeController?.revealRow(
      `file-editor:${activeProject?.id}:${parent.path}`,
      {
        focus: false,
      },
    ),
  );
}

function requestRename(entry: FilesystemProjectEntry): void {
  if (entry.path === "") return;
  editing = { mode: "rename", entry };
  void tick().then(() =>
    treeController?.revealRow(nodeId(entry.path), { focus: false }),
  );
}

function cancelEdit(): void {
  const previous = editing;
  editing = undefined;
  if (previous?.mode === "rename") void focusRow(previous.entry.path);
  else if (previous?.parentPath) void focusRow(previous.parentPath);
}

async function commitEdit(
  item: FileExplorerTreeItem,
  name: string,
): Promise<void> {
  const context = operationContext;
  const current = editing;
  editing = undefined;
  if (!context || !activeProject) return;
  if (item.type === "editor" && item.mode === "create") {
    try {
      const entry = await createFileExplorerEntry(
        context,
        item.parentPath,
        item.kind,
        name,
      );
      selection = selectOnly(entry.path);
      if (item.kind === "file")
        await openFilePane({ projectId: activeProject.id, path: entry.path });
      void focusRow(entry.path);
      notify.success(item.kind === "file" ? "File created" : "Folder created");
    } catch (caught) {
      notify.error(
        item.kind === "file"
          ? "Could not create file"
          : "Could not create folder",
        { description: describeFileOperationError(caught) },
      );
    }
  } else if (item.type === "entry" && current?.mode === "rename") {
    const from = item.entry.path;
    const to = joinPath(parentPath(from), name);
    const moved = await moveFileExplorerEntries(context, [{ from, to }], {
      verb: "Renamed",
    });
    if (moved.length > 0) {
      selection = selectOnly(to);
      void focusRow(to);
    } else void focusRow(from);
  }
}

// ----- Clipboard, duplicate, delete, mention ------------------------------

function setClipboard(mode: "cut" | "copy", entries: FilesystemProjectEntry[]) {
  clipboard = { mode, entries: entries.flatMap(dragItem) };
  if (clipboard.entries.length === 0) clipboard = undefined;
}

async function pasteInto(targetDirectory: string): Promise<void> {
  const context = operationContext;
  const source = clipboard;
  if (!context || !source) return;
  if (source.mode === "cut") {
    const plan = planDrop(source.entries, targetDirectory, "move");
    if (!plan.ok) {
      notify.message(plan.reason);
      return;
    }
    const moved = await moveFileExplorerEntries(context, plan.moves);
    if (moved.length > 0) clipboard = undefined;
  } else {
    const plan = planDrop(source.entries, targetDirectory, "copy");
    if (!plan.ok) {
      notify.message(plan.reason);
      return;
    }
    await copyFileExplorerEntries(
      context,
      planCopyNames(context.projectId, source.entries, targetDirectory),
    );
  }
  if (targetDirectory) expandPath(targetDirectory);
}

function pasteTargetFor(entry: FilesystemProjectEntry): string {
  return entry.kind === "directory" && !entry.symlink
    ? entry.path
    : parentPath(entry.path);
}

async function duplicate(entries: FilesystemProjectEntry[]): Promise<void> {
  const context = operationContext;
  if (!context) return;
  const byParent = new SvelteMap<string, ProjectEntryDragItem[]>();
  for (const entry of entries) {
    const parent = parentPath(entry.path);
    byParent.set(parent, [...(byParent.get(parent) ?? []), ...dragItem(entry)]);
  }
  for (const [parent, items] of byParent) {
    const pairs = planCopyNames(context.projectId, items, parent);
    await copyFileExplorerEntries(context, pairs, { verb: "Duplicated" });
  }
}

function requestDelete(entries: FilesystemProjectEntry[]): void {
  const keep = new Set(topLevelPaths(entries.map((entry) => entry.path)));
  const targets = entries.filter((entry) => keep.has(entry.path));
  if (targets.length > 0) pendingDelete = targets;
}

async function confirmDelete(): Promise<void> {
  const entries = pendingDelete;
  const context = operationContext;
  pendingDelete = undefined;
  if (!entries || !context) return;
  await deleteFileExplorerEntries(context, entries, deleteMethod);
  selection = emptyFileExplorerSelection;
}

function mention(entries: FilesystemProjectEntry[]): void {
  const references = entries.flatMap(dragItem).map(formatProjectEntryReference);
  if (!requestComposerMentions(references))
    notify.message("Open a conversation to mention files");
}

function expandPath(path: string): void {
  const entry = findEntry(path);
  if (entry) setExpanded({ type: "entry", entry }, true);
}

// ----- Selection and keyboard ---------------------------------------------

function handleItemClick(
  event: MouseEvent,
  item: FileExplorerTreeItem,
): boolean {
  if (item.type !== "entry") return false;
  const path = item.entry.path;
  if (event.shiftKey) {
    selection = selectRange(visiblePaths, selection, path);
    return true;
  }
  if (event.metaKey || event.ctrlKey) {
    selection = toggleSelected(selection, path);
    return true;
  }
  selection = selectOnly(path);
  return false;
}

function extendSelection(path: string, direction: 1 | -1): void {
  const index = visiblePaths.indexOf(path);
  const neighbor = visiblePaths[index + direction];
  if (index < 0 || neighbor === undefined) return;
  const base = selection.ids.size > 0 ? selection : selectOnly(path);
  selection = selectRange(visiblePaths, base, neighbor);
  void treeController?.revealRow(nodeId(neighbor));
}

function handleItemKeydown(
  event: KeyboardEvent,
  item: FileExplorerTreeItem,
): boolean {
  if (item.type !== "entry") return false;
  const entry = item.entry;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (
    event.shiftKey &&
    !modifier &&
    (key === "arrowdown" || key === "arrowup")
  ) {
    extendSelection(entry.path, key === "arrowdown" ? 1 : -1);
    return true;
  }
  if (!modifier && !event.shiftKey && !event.altKey) {
    if (event.key === "F2") {
      requestRename(entry);
      return true;
    }
    if (event.key === "Delete") {
      requestDelete(actionTargets(entry));
      return true;
    }
    if (event.key === "Escape" && selection.ids.size > 0) {
      selection = emptyFileExplorerSelection;
      return true;
    }
  }
  if (modifier && !event.altKey && !event.shiftKey) {
    if (key === "backspace") {
      requestDelete(actionTargets(entry));
      return true;
    }
    if (key === "c" || key === "x") {
      setClipboard(key === "c" ? "copy" : "cut", actionTargets(entry));
      return true;
    }
    if (key === "v") {
      if (clipboard) void pasteInto(pasteTargetFor(entry));
      return true;
    }
    if (key === "d") {
      void duplicate(actionTargets(entry));
      return true;
    }
    if (key === "a") {
      selection = {
        ids: new Set(visiblePaths),
        anchorId: visiblePaths[0],
      };
      return true;
    }
  }
  return false;
}

// ----- Drag and drop, menus -----------------------------------------------

const drag = new FilesTreeDrag({
  projectId: () => activeProject?.id,
  operationContext: () => operationContext,
  actionTargets,
  dragItem,
  pasteTargetFor,
  isSelected: (path) => selection.ids.has(path),
  selectOnly: (path) => {
    selection = selectOnly(path);
  },
  isExpanded: (directory) =>
    Boolean(project?.expandedIds.has(nodeId(directory))),
  expandPath,
  refreshDirectories,
});

const menuContext = $derived<FilesContextMenuContext>({
  project: activeProject,
  isDesktop: desktopRuntime.isDesktop,
  platform: desktopRuntime.platform,
  canPaste: clipboard !== undefined,
  selectionIds: selection.ids,
  editors: editorAvailability,
  terminal: terminalAvailability,
  onOpenInEditor,
  onOpenInTerminal,
  actionTargets,
  pasteTargetFor,
  openFromMenu,
  requestCreate,
  requestRename,
  requestDelete,
  duplicate,
  setClipboard,
  pasteInto,
  mention,
  copyText,
  openNative: (entry) => void runNativeAction("openProjectEntry", entry),
  revealNative: (entry) => void runNativeAction("revealProjectEntry", entry),
});
const rootMenu = () => buildFilesRootMenu(menuContext, rootEntry);
const itemMenu = (item: FileExplorerTreeItem) =>
  buildFilesItemMenu(menuContext, item);

// ----- Lifecycle ----------------------------------------------------------

let fileController: FilePanelController | undefined;

$effect(() => {
  const projectId = activeProject?.id;
  if (!projectId || !workbenchStartupState.progressiveActive) return;
  gitFiles = [];
  gitIssue = undefined;
  monitorIssue = undefined;
  selection = emptyFileExplorerSelection;
  editing = undefined;
  fileController = startFilePanelController({
    projectId,
    onMonitorIssue: (issue) => {
      if (activeProject?.id === projectId) monitorIssue = issue;
    },
    initialize: async () => {
      await Promise.all([
        ensureFileExplorerRoot(projectId),
        refreshGitStatus(projectId),
      ]);
    },
    refresh: (directories) => refreshAll(projectId, directories),
  });
  return () => {
    fileController?.stop();
    fileController = undefined;
    drag.clear();
  };
});

// Selection only ever holds rows that are still visible.
$effect(() => {
  const visible = new Set(visiblePaths);
  untrack(() => {
    selection = pruneSelection(selection, visible);
  });
});

// Follow the active editor file.
$effect(() => {
  const projectId = activeProject?.id;
  const path = activeRelativePath;
  if (
    !projectId ||
    !path ||
    !filesPanelPreferences.autoReveal ||
    !workbenchStartupState.progressiveActive
  )
    return;
  untrack(() => {
    if (selection.ids.size === 1 && selection.ids.has(path)) return;
    void revealFileExplorerPath(projectId, path, { auto: true });
  });
});

// A reveal request (auto reveal, "Reveal in Files", quick open) lands here.
$effect(() => {
  const token = fileExplorerRevealRequest.token;
  const requestedProject = fileExplorerRevealRequest.projectId;
  const path = fileExplorerRevealRequest.path;
  if (token === handledRevealToken || !path) return;
  if (!activeProject || requestedProject !== activeProject.id) return;
  if (!treeController) return;
  handledRevealToken = token;
  const focus = fileExplorerRevealRequest.focus;
  untrack(() => {
    if (focus) filterText = "";
    syncMonitorDemand();
    selection = selectOnly(path);
    void tick()
      .then(() => tick())
      .then(() => treeController?.revealRow(nodeId(path), { focus }));
  });
});
</script>

<FilesPanel
  projectName={activeProject?.name}
  {root}
  {nodes}
  expandedIds={treeExpandedIds}
  {busy}
  {statusIssues}
  isEntryOpen={(path) =>
    Boolean(
      activeProject &&
      treeExpandedIds.has(fileExplorerEntryNodeId(activeProject.id, path)),
    )}
  {selectedPaths}
  {cutPaths}
  {gitDecorations}
  preferences={filesPanelPreferences}
  bind:filterOpen
  bind:filterText
  renamingPath={editing?.mode === "rename" ? editing.entry.path : undefined}
  siblingNames={(directory) =>
    activeProject ? listedNames(activeProject.id, directory) : new Set()}
  {rootMenu}
  {itemMenu}
  dropTargetPath={drag.dropTargetPath}
  rootDropActive={drag.rootDropActive}
  externalDropHint={drag.externalDropHint}
  {pendingDelete}
  {deleteDescription}
  deleteLabel={deleteMethod === "trash" ? "Move to Trash" : "Delete"}
  pendingReplace={drag.pendingReplace?.message}
  bind:treeController
  onPreferenceChange={setFilesPanelPreference}
  onQuickOpen={() => quickOpen.show(activeProject?.id)}
  onCollapseAll={collapseAll}
  onRefresh={() => {
    if (activeProject) void fileController?.requestRefresh();
  }}
  onRetry={() => {
    if (activeProject) void ensureFileExplorerRoot(activeProject.id);
  }}
  onRetryStatus={() => {
    if (!activeProject) return;
    void fileController?.updateMonitorDemand();
    void fileController?.requestRefresh();
  }}
  onActivate={activate}
  onExpansionChange={setExpanded}
  onItemClick={handleItemClick}
  onItemKeydown={handleItemKeydown}
  onDragStart={drag.start}
  onDragEnd={drag.clear}
  onItemDragEnter={drag.itemOver}
  onItemDragOver={drag.itemOver}
  onItemDragLeave={() => undefined}
  onItemDrop={drag.itemDrop}
  onRootDragOver={drag.rootOver}
  onRootDragLeave={drag.rootLeave}
  onRootDrop={(event) => void drag.drop(event, "")}
  onCommitEdit={(item, name) => void commitEdit(item, name)}
  onCancelEdit={cancelEdit}
  onConfirmDelete={() => void confirmDelete()}
  onCancelDelete={() => (pendingDelete = undefined)}
  onConfirmReplace={drag.confirmReplace}
  onCancelReplace={drag.cancelReplace}
/>
