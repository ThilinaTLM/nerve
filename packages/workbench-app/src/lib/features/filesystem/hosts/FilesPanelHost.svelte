<script lang="ts" module>
/** Last reveal request this module handled, so remounting never replays it. */
let handledRevealToken = 0;
</script>

<script lang="ts">
import type { Project } from "@nervekit/contracts/core";
import AtSign from "@lucide/svelte/icons/at-sign";
import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
import Copy from "@lucide/svelte/icons/copy";
import CopyPlus from "@lucide/svelte/icons/copy-plus";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FileText from "@lucide/svelte/icons/file-text";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Locate from "@lucide/svelte/icons/locate";
import Pencil from "@lucide/svelte/icons/pencil";
import Scissors from "@lucide/svelte/icons/scissors";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { tick, untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { ProjectEditor, StatusResponse } from "$lib/api";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import type { GitProjectFileStatus } from "@nervekit/contracts/git";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { getProjectGitFileStatus } from "$lib/api";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  desktopRuntime,
  getDesktopBridge,
} from "$lib/platform/desktop/desktop-bridge.svelte";
import { ApiRequestError } from "$lib/platform/http/api-client";
import { uploadProjectFiles } from "$lib/features/filesystem/api/filesystem.api";
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
import {
  collectDroppedFiles,
  hasOsFiles,
  uploadLimitError,
  type DroppedFile,
} from "$lib/features/filesystem/state/file-explorer-drop";
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
  PROJECT_ENTRY_DRAG_MIME,
  serializeProjectEntryDrag,
  type ProjectEntryDragItem,
} from "$lib/presentation/dnd/project-entry-drag";
import { buildExternalLaunchMenu } from "$lib/presentation/brand/external-launch-menu";
import {
  visiblePanelTreeRows,
  type PanelTreeController,
} from "$lib/presentation/panels";
import FilesPanel from "../views/FilesPanel.svelte";
import {
  absoluteProjectPath,
  buildFileExplorerMenu,
  buildFileExplorerSelectionMenu,
  buildProjectRootMenu,
  type FileExplorerMenuIcons,
  type FileExplorerShortcutLabels,
} from "../views/file-explorer-menu";

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
const AUTO_EXPAND_DELAY_MS = 600;

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
let pendingReplace = $state<{
  parent: string;
  files: DroppedFile[];
  message: string;
}>();
let dropTargetPath = $state<string>();
let rootDropActive = $state(false);
let externalDropHint = $state(false);
let treeController = $state<PanelTreeController>();
let dragSources: ProjectEntryDragItem[] | undefined;
let autoExpand:
  | { path: string; timer: ReturnType<typeof setTimeout> }
  | undefined;

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
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
const shortcuts: FileExplorerShortcutLabels = {
  rename: "F2",
  duplicate: isMac ? "⌘D" : "Ctrl+D",
  cut: isMac ? "⌘X" : "Ctrl+X",
  copy: isMac ? "⌘C" : "Ctrl+C",
  paste: isMac ? "⌘V" : "Ctrl+V",
  delete: isMac ? "⌘⌫" : "Del",
};
const menuIcons: FileExplorerMenuIcons = {
  open: FileText,
  copy: Copy,
  openDefault: ExternalLink,
  newFile: FilePlus,
  reveal: Locate,
  newFolder: FolderPlus,
  trash: Trash2,
  rename: Pencil,
  duplicate: CopyPlus,
  cut: Scissors,
  paste: ClipboardPaste,
  mention: AtSign,
};
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
        projectDirectory: activeProject.directory,
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
      root: activeProject.directory,
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

// ----- Drag and drop ------------------------------------------------------

function startEntryDrag(event: DragEvent, item: FileExplorerTreeItem): void {
  if (item.type !== "entry" || !event.dataTransfer) return;
  const targets = actionTargets(item.entry);
  const entries = targets.flatMap(dragItem);
  if (entries.length === 0) return;
  if (!selection.ids.has(item.entry.path))
    selection = selectOnly(item.entry.path);
  dragSources = entries;
  event.dataTransfer.setData(
    PROJECT_ENTRY_DRAG_MIME,
    serializeProjectEntryDrag(entries),
  );
  event.dataTransfer.setData(
    "text/plain",
    entries.map(formatProjectEntryReference).join(" "),
  );
  // Move inside the tree, copy into the composer (or Alt-copy inside the tree).
  event.dataTransfer.effectAllowed = "copyMove";
}

function clearDragState(): void {
  dragSources = undefined;
  dropTargetPath = undefined;
  rootDropActive = false;
  externalDropHint = false;
  if (autoExpand) clearTimeout(autoExpand.timer);
  autoExpand = undefined;
}

function dropDirectoryFor(item: FileExplorerTreeItem): string | undefined {
  if (item.type !== "entry") return undefined;
  return pasteTargetFor(item.entry);
}

function highlightDropTarget(directory: string): void {
  rootDropActive = directory === "";
  dropTargetPath = directory === "" ? undefined : directory;
  if (!directory || autoExpand?.path === directory) return;
  if (autoExpand) clearTimeout(autoExpand.timer);
  const expanded = project?.expandedIds.has(nodeId(directory));
  autoExpand = expanded
    ? undefined
    : {
        path: directory,
        timer: setTimeout(() => expandPath(directory), AUTO_EXPAND_DELAY_MS),
      };
}

/** Accepts a drag over `directory` when it is a valid move/copy/upload there. */
function acceptDrag(event: DragEvent, directory: string): boolean {
  if (!event.dataTransfer) return false;
  const types = [...event.dataTransfer.types];
  if (dragSources) {
    const copy = event.altKey;
    const plan = planDrop(dragSources, directory, copy ? "copy" : "move");
    if (!plan.ok) {
      event.dataTransfer.dropEffect = "none";
      dropTargetPath = undefined;
      rootDropActive = false;
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = copy ? "copy" : "move";
  } else if (hasOsFiles(types)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    externalDropHint = true;
  } else {
    return false;
  }
  highlightDropTarget(directory);
  return true;
}

function handleItemDragOver(
  event: DragEvent,
  item: FileExplorerTreeItem,
): void {
  const directory = dropDirectoryFor(item);
  if (directory === undefined) return;
  event.stopPropagation();
  acceptDrag(event, directory);
}

function handleRootDragOver(event: DragEvent): void {
  acceptDrag(event, "");
}

function handleRootDragLeave(event: DragEvent): void {
  const related = event.relatedTarget;
  if (
    related instanceof Node &&
    (event.currentTarget as Node).contains(related)
  )
    return;
  dropTargetPath = undefined;
  rootDropActive = false;
  externalDropHint = false;
}

async function performDrop(event: DragEvent, directory: string): Promise<void> {
  const context = operationContext;
  const dataTransfer = event.dataTransfer;
  const sources = dragSources;
  const copy = event.altKey;
  if (!context || !dataTransfer) return;
  if (sources) {
    event.preventDefault();
    clearDragState();
    const plan = planDrop(sources, directory, copy ? "copy" : "move");
    if (!plan.ok) {
      notify.message(plan.reason);
      return;
    }
    if (copy)
      await copyFileExplorerEntries(
        context,
        planCopyNames(context.projectId, sources, directory),
      );
    else await moveFileExplorerEntries(context, plan.moves);
    if (directory) expandPath(directory);
    return;
  }
  if (hasOsFiles([...dataTransfer.types])) {
    event.preventDefault();
    clearDragState();
    const files = await collectDroppedFiles(dataTransfer);
    await uploadFiles(directory, files);
  }
}

function handleItemDrop(event: DragEvent, item: FileExplorerTreeItem): void {
  const directory = dropDirectoryFor(item);
  if (directory === undefined) return;
  event.stopPropagation();
  void performDrop(event, directory);
}

async function uploadFiles(
  directory: string,
  files: DroppedFile[],
  overwrite = false,
): Promise<void> {
  const projectId = activeProject?.id;
  if (!projectId || files.length === 0) return;
  const tooLarge = uploadLimitError(files);
  if (tooLarge) {
    notify.error("Could not add files", { description: tooLarge });
    return;
  }
  try {
    const response = await uploadProjectFiles(projectId, directory, files, {
      overwrite,
    });
    await refreshDirectories([directory]);
    if (directory) expandPath(directory);
    notify.success(
      response.entries.length === 1
        ? `Added “${response.entries[0]?.name}”`
        : `Added ${response.entries.length} files`,
    );
  } catch (caught) {
    if (
      caught instanceof ApiRequestError &&
      caught.code === "PROJECT_ENTRY_EXISTS"
    ) {
      pendingReplace = { parent: directory, files, message: caught.message };
      return;
    }
    notify.error("Could not add files", {
      description: describeFileOperationError(caught),
    });
  }
}

function confirmReplace(): void {
  const pending = pendingReplace;
  pendingReplace = undefined;
  if (pending) void uploadFiles(pending.parent, pending.files, true);
}

// ----- Menus --------------------------------------------------------------

function launchMenu(entry?: FilesystemProjectEntry): ContextMenuItem[] {
  if (!activeProject || (entry && entry.kind === "other")) return [];
  const path = entry?.path;
  return buildExternalLaunchMenu({
    targetKind: entry?.kind === "file" ? "file" : "directory",
    editors: editorAvailability,
    terminal: terminalAvailability,
    openEditor: (editor) => onOpenInEditor?.(activeProject.id, editor, path),
    openTerminal: () => onOpenInTerminal?.(activeProject.id, path),
  });
}

function rootMenu(): ContextMenuItem[] {
  const entry = rootEntry;
  if (!activeProject || !entry) return [];
  return buildProjectRootMenu(
    {
      createFile: () => requestCreate("file", entry),
      createFolder: () => requestCreate("directory", entry),
      paste: () => void pasteInto(""),
      canPaste: clipboard !== undefined,
      openDefault: () => void runNativeAction("openProjectEntry", entry),
      reveal: () => void runNativeAction("revealProjectEntry", entry),
      copyPath: () => void copyText(activeProject.directory, "path"),
    },
    desktopRuntime.isDesktop,
    menuIcons,
    launchMenu(),
    shortcuts,
  );
}

function itemMenu(item: FileExplorerTreeItem): ContextMenuItem[] {
  if (item.type !== "entry" || !activeProject) return [];
  const entry = item.entry;
  if (selection.ids.has(entry.path) && selection.ids.size > 1) {
    const targets = actionTargets(entry);
    return buildFileExplorerSelectionMenu(
      {
        count: targets.length,
        cut: () => setClipboard("cut", targets),
        copy: () => setClipboard("copy", targets),
        mention: () => mention(targets),
        copyPaths: () =>
          void copyText(
            targets.map((target) => target.path).join("\n"),
            "paths",
          ),
        remove: () => requestDelete(targets),
      },
      desktopRuntime.isDesktop,
      menuIcons,
      shortcuts,
    );
  }
  const absolutePath = absoluteProjectPath(
    activeProject.directory,
    entry.path,
    desktopRuntime.platform,
  );
  return buildFileExplorerMenu(
    entry,
    {
      open: () => openFromMenu(item),
      createFile: () => requestCreate("file", entry),
      createFolder: () => requestCreate("directory", entry),
      rename: () => requestRename(entry),
      duplicate: () => void duplicate([entry]),
      cut: () => setClipboard("cut", [entry]),
      copy: () => setClipboard("copy", [entry]),
      paste: () => void pasteInto(pasteTargetFor(entry)),
      canPaste: clipboard !== undefined,
      mention: () => mention([entry]),
      openDefault: () => void runNativeAction("openProjectEntry", entry),
      reveal: () => void runNativeAction("revealProjectEntry", entry),
      copyPath: () => void copyText(absolutePath, "path"),
      copyRelativePath: () => void copyText(entry.path, "relative path"),
      remove: () => requestDelete([entry]),
    },
    desktopRuntime.isDesktop,
    {
      ...menuIcons,
      open: entry.kind === "directory" ? FolderOpen : FileText,
    },
    launchMenu(entry),
    shortcuts,
  );
}

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
    clearDragState();
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
  {dropTargetPath}
  {rootDropActive}
  {externalDropHint}
  {pendingDelete}
  {deleteDescription}
  deleteLabel={deleteMethod === "trash" ? "Move to Trash" : "Delete"}
  pendingReplace={pendingReplace?.message}
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
  onDragStart={startEntryDrag}
  onDragEnd={clearDragState}
  onItemDragEnter={handleItemDragOver}
  onItemDragOver={handleItemDragOver}
  onItemDragLeave={() => undefined}
  onItemDrop={handleItemDrop}
  onRootDragOver={handleRootDragOver}
  onRootDragLeave={handleRootDragLeave}
  onRootDrop={(event) => void performDrop(event, "")}
  onCommitEdit={(item, name) => void commitEdit(item, name)}
  onCancelEdit={cancelEdit}
  onConfirmDelete={() => void confirmDelete()}
  onCancelDelete={() => (pendingDelete = undefined)}
  onConfirmReplace={confirmReplace}
  onCancelReplace={() => (pendingReplace = undefined)}
/>
