/* eslint-disable svelte/prefer-svelte-reactivity -- derived sets are rebuilt, never mutated */
import type { Project } from "@nervekit/contracts/core";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import type { GitProjectFileStatus } from "@nervekit/contracts/git";
import { tick, untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import {
  getProjectGitFileStatus,
  type ProjectEditor,
  type StatusResponse,
} from "$lib/api";
import { requestComposerMentions } from "$lib/application/composer/composer-mention-requests.svelte";
import {
  errorDetails,
  showCriticalError,
} from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  desktopRuntime,
  getDesktopBridge,
} from "$lib/platform/desktop/desktop-bridge.svelte";
import {
  formatProjectEntryReference,
  type ProjectEntryDragItem,
} from "$lib/presentation/dnd/project-entry-drag";
import {
  visiblePanelTreeRows,
  type PanelTreeController,
} from "$lib/presentation/panels";
import {
  activateFileExplorerItem,
  collapseAllFileExplorerItems,
  ensureFileExplorerRoot,
  monitoredFileExplorerDirectories,
  refreshFileExplorerProject,
  revealFileExplorerPath,
  setFileExplorerItemExpanded,
} from "./file-explorer-actions.svelte";
import {
  copyFileExplorerEntries,
  createFileExplorerEntry,
  deleteFileExplorerEntries,
  moveFileExplorerEntries,
  planCopyNames,
  type DeleteMethod,
  type FileOperationContext,
} from "./file-explorer-operations.svelte";
import {
  joinPath,
  parentPath,
  planDrop,
  topLevelPaths,
} from "./file-explorer-paths";
import {
  emptyFileExplorerSelection,
  pruneSelection,
  selectOnly,
  selectRange,
  toggleSelected,
  type FileExplorerSelection,
} from "./file-explorer-selection";
import {
  fileExplorerRevealRequest,
  fileExplorerState,
} from "./file-explorer-state.svelte";
import {
  buildFileExplorerTreeView,
  fileExplorerEntryNodeId,
  type FileExplorerEntryItem,
  type FileExplorerTreeItem,
} from "./file-explorer-tree";
import { indexFileTreeGitDecorations } from "./file-git-status";
import { describeFileOperationError } from "./file-operation-errors";
import {
  describeGitStatusErrors,
  describeGitStatusFailure,
} from "./file-panel-status";
import {
  startFilePanelController,
  type FilePanelController,
} from "./file-panel-controller.svelte";
import { fileSelectors } from "./file-selectors.svelte";
import { openFilePane } from "./file-tabs.svelte";
import {
  buildFilesItemMenu,
  buildFilesRootMenu,
  type FilesContextMenuContext,
} from "./files-context-menu";
import { fileTreeKeyAction } from "./files-tree-keyboard";
import { filesPanelPreferences } from "./files-panel-preferences.svelte";
import { FilesTreeDrag } from "./files-tree-drag.svelte";

/** Last reveal request this module handled, so remounting never replays it. */
let handledRevealToken = 0;

const noExpandedIds: ReadonlySet<string> = new Set();

type Editing =
  | { mode: "create"; parentPath: string; kind: "file" | "directory" }
  | { mode: "rename"; entry: FilesystemProjectEntry };

export type FilesTreeControllerDependencies = {
  activeProject: () => Project | undefined;
  editorAvailability: () => StatusResponse["runtime"]["editors"] | undefined;
  terminalAvailability: () => StatusResponse["runtime"]["terminal"] | undefined;
  onOpenInEditor: () =>
    | ((projectId: string, editor: ProjectEditor, path?: string) => void)
    | undefined;
  onOpenInTerminal: () =>
    | ((projectId: string, path?: string) => void)
    | undefined;
  /** Git demand plus change callback for a project; composed by the app. */
  watchGit: () =>
    | ((projectId: string, onChange: () => void) => () => void)
    | undefined;
};

/**
 * Files tree state: data refresh, selection, inline edit, clipboard, delete
 * confirmation, keyboard handling and context menus. Effect wiring stays in
 * the host component; it calls the lifecycle methods below.
 */
export class FilesTreeController {
  gitFiles = $state<GitProjectFileStatus[]>([]);
  gitIssue = $state<string>();
  monitorIssue = $state<string>();
  selection = $state<FileExplorerSelection>(emptyFileExplorerSelection);
  editing = $state<Editing>();
  clipboard = $state<{
    mode: "cut" | "copy";
    entries: ProjectEntryDragItem[];
  }>();
  filterOpen = $state(false);
  filterText = $state("");
  pendingDelete = $state<FilesystemProjectEntry[]>();
  treeController = $state<PanelTreeController>();

  readonly #deps: FilesTreeControllerDependencies;
  #fileController: FilePanelController | undefined;

  readonly drag: FilesTreeDrag;

  readonly project = $derived.by(() => {
    const active = this.#deps.activeProject();
    return active ? fileExplorerState.projects[active.id] : undefined;
  });
  readonly root = $derived(this.project?.directories[""]);
  readonly treeView = $derived(
    this.project
      ? buildFileExplorerTreeView(this.project, {
          hideIgnored: filesPanelPreferences.hideIgnored,
          hideDotfiles: !filesPanelPreferences.showDotfiles,
          filter: this.filterText,
          creating:
            this.editing?.mode === "create"
              ? {
                  parentPath: this.editing.parentPath,
                  kind: this.editing.kind,
                }
              : undefined,
        })
      : { nodes: [], filterExpandedIds: noExpandedIds },
  );
  readonly nodes = $derived(this.treeView.nodes);
  readonly treeExpandedIds = $derived.by<ReadonlySet<string>>(() => {
    const base = this.project?.expandedIds ?? noExpandedIds;
    return this.treeView.filterExpandedIds.size > 0
      ? new Set([...base, ...this.treeView.filterExpandedIds])
      : base;
  });
  readonly visiblePaths = $derived(
    visiblePanelTreeRows(this.nodes, this.treeExpandedIds).flatMap((row) =>
      row.node.kind === "item" && row.node.value.type === "entry"
        ? [row.node.value.entry.path]
        : [],
    ),
  );
  readonly gitDecorations = $derived(
    indexFileTreeGitDecorations(this.gitFiles),
  );
  readonly activeRelativePath = $derived.by(() => {
    const file = fileSelectors.activeCenterFileView;
    if (!file || file.projectId !== this.#deps.activeProject()?.id)
      return undefined;
    return file.content?.relativePath ?? file.path;
  });
  /** The multi-selection, or the active editor file while nothing is selected. */
  readonly selectedPaths = $derived<ReadonlySet<string>>(
    this.selection.ids.size > 0
      ? this.selection.ids
      : this.activeRelativePath
        ? new Set([this.activeRelativePath])
        : new Set<string>(),
  );
  readonly cutPaths = $derived<ReadonlySet<string>>(
    this.clipboard?.mode === "cut"
      ? new Set(this.clipboard.entries.map((entry) => entry.path))
      : new Set<string>(),
  );
  readonly rootEntry = $derived.by<FilesystemProjectEntry | undefined>(() => {
    const active = this.#deps.activeProject();
    return active
      ? { name: active.name, path: "", kind: "directory", symlink: false }
      : undefined;
  });
  readonly statusIssues = $derived(
    [this.monitorIssue, this.gitIssue].filter((issue) => issue !== undefined),
  );
  readonly busy = $derived(
    Object.values(this.project?.directories ?? {}).some(
      (directory) => directory.loading || directory.refreshing,
    ),
  );
  readonly deleteMethod = $derived<DeleteMethod>(
    desktopRuntime.isDesktop ? "trash" : "delete",
  );
  readonly deleteDescription = $derived.by(() => {
    const entries = this.pendingDelete;
    if (!entries?.length) return undefined;
    const subject =
      entries.length === 1
        ? `“${entries[0]?.name}”`
        : `${entries.length} items`;
    return this.deleteMethod === "trash"
      ? `${subject} will be moved to the operating-system trash and may be recoverable there.`
      : `${subject} will be permanently deleted. This cannot be undone.`;
  });
  readonly operationContext = $derived.by<FileOperationContext | undefined>(
    () => {
      const active = this.#deps.activeProject();
      return active
        ? {
            projectId: active.id,
            refresh: this.refreshDirectories,
            syncMonitorDemand: this.syncMonitorDemand,
          }
        : undefined;
    },
  );
  readonly menuContext = $derived.by<FilesContextMenuContext>(() => ({
    project: this.#deps.activeProject(),
    isDesktop: desktopRuntime.isDesktop,
    platform: desktopRuntime.platform,
    canPaste: this.clipboard !== undefined,
    selectionIds: this.selection.ids,
    editors: this.#deps.editorAvailability(),
    terminal: this.#deps.terminalAvailability(),
    onOpenInEditor: this.#deps.onOpenInEditor(),
    onOpenInTerminal: this.#deps.onOpenInTerminal(),
    actionTargets: this.actionTargets,
    pasteTargetFor: this.pasteTargetFor,
    openFromMenu: this.openFromMenu,
    requestCreate: this.requestCreate,
    requestRename: this.requestRename,
    requestDelete: this.requestDelete,
    duplicate: this.duplicate,
    setClipboard: this.setClipboard,
    pasteInto: this.pasteInto,
    mention: this.mention,
    copyText: this.copyText,
    openNative: (entry) => void this.runNativeAction("openProjectEntry", entry),
    revealNative: (entry) =>
      void this.runNativeAction("revealProjectEntry", entry),
  }));

  constructor(deps: FilesTreeControllerDependencies) {
    this.#deps = deps;
    this.drag = new FilesTreeDrag({
      projectId: () => deps.activeProject()?.id,
      operationContext: () => this.operationContext,
      actionTargets: this.actionTargets,
      dragItem: this.dragItem,
      pasteTargetFor: this.pasteTargetFor,
      isSelected: (path) => this.selection.ids.has(path),
      selectOnly: (path) => {
        this.selection = selectOnly(path);
      },
      isExpanded: (directory) =>
        Boolean(this.project?.expandedIds.has(this.nodeId(directory))),
      expandPath: this.expandPath,
      refreshDirectories: this.refreshDirectories,
    });
  }

  rootMenu = () => buildFilesRootMenu(this.menuContext, this.rootEntry);
  itemMenu = (item: FileExplorerTreeItem) =>
    buildFilesItemMenu(this.menuContext, item);

  // ----- Lifecycle (host effects call these) -------------------------------

  /** Starts the per-project file panel controller; returns its cleanup. */
  startProject(): (() => void) | undefined {
    const projectId = this.#deps.activeProject()?.id;
    if (!projectId || !workbenchStartupState.progressiveActive) return;
    this.gitFiles = [];
    this.gitIssue = undefined;
    this.monitorIssue = undefined;
    this.selection = emptyFileExplorerSelection;
    this.editing = undefined;
    this.#fileController = startFilePanelController({
      projectId,
      onMonitorIssue: (issue) => {
        if (this.#deps.activeProject()?.id === projectId)
          this.monitorIssue = issue;
      },
      initialize: async () => {
        await Promise.all([
          ensureFileExplorerRoot(projectId),
          this.refreshGitStatus(projectId),
        ]);
      },
      refresh: (directories) => this.refreshAll(projectId, directories),
    });
    // Decorations follow the server's Git workspace (stage, terminal commit).
    const releaseGit = this.#deps.watchGit()?.(projectId, () => {
      void this.refreshGitStatus(projectId);
    });
    return () => {
      releaseGit?.();
      this.#fileController?.stop();
      this.#fileController = undefined;
      this.drag.clear();
    };
  }

  /** Selection only ever holds rows that are still visible. */
  pruneToVisible(): void {
    const visible = new Set(this.visiblePaths);
    untrack(() => {
      this.selection = pruneSelection(this.selection, visible);
    });
  }

  /** Follow the active editor file. */
  followActiveFile(): void {
    const projectId = this.#deps.activeProject()?.id;
    const path = this.activeRelativePath;
    if (
      !projectId ||
      !path ||
      !filesPanelPreferences.autoReveal ||
      !workbenchStartupState.progressiveActive
    )
      return;
    untrack(() => {
      if (this.selection.ids.size === 1 && this.selection.ids.has(path)) return;
      void revealFileExplorerPath(projectId, path, { auto: true });
    });
  }

  /** A reveal request (auto reveal, "Reveal in Files", quick open) lands here. */
  handleRevealRequest(): void {
    const token = fileExplorerRevealRequest.token;
    const requestedProject = fileExplorerRevealRequest.projectId;
    const path = fileExplorerRevealRequest.path;
    const active = this.#deps.activeProject();
    if (token === handledRevealToken || !path) return;
    if (!active || requestedProject !== active.id) return;
    if (!this.treeController) return;
    handledRevealToken = token;
    const focus = fileExplorerRevealRequest.focus;
    untrack(() => {
      if (focus) this.filterText = "";
      this.syncMonitorDemand();
      this.selection = selectOnly(path);
      void tick()
        .then(() => tick())
        .then(() =>
          this.treeController?.revealRow(this.nodeId(path), { focus }),
        );
    });
  }

  // ----- Panel header actions ---------------------------------------------

  requestRefresh = (): void => {
    if (this.#deps.activeProject()) void this.#fileController?.requestRefresh();
  };

  retryRoot = (): void => {
    const active = this.#deps.activeProject();
    if (active) void ensureFileExplorerRoot(active.id);
  };

  retryStatus = (): void => {
    if (!this.#deps.activeProject()) return;
    void this.#fileController?.updateMonitorDemand();
    void this.#fileController?.requestRefresh();
  };

  collapseAll = (): void => {
    const active = this.#deps.activeProject();
    if (!active) return;
    collapseAllFileExplorerItems(active.id);
    this.syncMonitorDemand();
  };

  // ----- Data refresh ------------------------------------------------------

  syncMonitorDemand = (): void => {
    const active = this.#deps.activeProject();
    if (active)
      void this.#fileController?.updateMonitorDemand(
        monitoredFileExplorerDirectories(active.id),
      );
  };

  /** Refreshes watched directories now and marks cached, collapsed ones stale. */
  refreshDirectories = async (directories: string[]): Promise<void> => {
    const projectId = this.#deps.activeProject()?.id;
    if (!projectId) return;
    const monitored = new Set(monitoredFileExplorerDirectories(projectId));
    const state = fileExplorerState.projects[projectId];
    for (const path of directories) {
      const directory = state?.directories[path];
      if (directory && !monitored.has(path)) directory.stale = true;
    }
    await Promise.all([
      refreshFileExplorerProject(projectId, directories),
      this.refreshGitStatus(projectId),
    ]);
  };

  async refreshGitStatus(projectId: string, followup = false): Promise<void> {
    try {
      const response = await getProjectGitFileStatus(projectId);
      if (this.#deps.activeProject()?.id !== projectId) return;
      this.gitFiles = response.files;
      this.gitIssue = describeGitStatusErrors(response.errors);
      // A stale read crossed a monitor poll; re-read once, without retrying further.
      if (response.stale && !followup)
        await this.refreshGitStatus(projectId, true);
    } catch (caught) {
      // Decorations are best effort: keep the last status but say it may be outdated.
      if (this.#deps.activeProject()?.id === projectId)
        this.gitIssue = describeGitStatusFailure(caught);
    }
  }

  async refreshAll(
    projectId: string,
    directories?: readonly string[],
  ): Promise<void> {
    await Promise.all([
      refreshFileExplorerProject(projectId, directories),
      this.refreshGitStatus(projectId),
    ]);
  }

  // ----- Lookup ------------------------------------------------------------

  findEntry(path: string): FilesystemProjectEntry | undefined {
    return this.project?.directories[parentPath(path)]?.entries.find(
      (entry) => entry.path === path,
    );
  }

  nodeId = (path: string): string =>
    fileExplorerEntryNodeId(this.#deps.activeProject()?.id ?? "", path);

  isEntryOpen = (path: string): boolean => {
    const active = this.#deps.activeProject();
    return Boolean(
      active &&
      this.treeExpandedIds.has(fileExplorerEntryNodeId(active.id, path)),
    );
  };

  dragItem = (entry: FilesystemProjectEntry): ProjectEntryDragItem[] =>
    entry.kind === "file" || entry.kind === "directory"
      ? [{ path: entry.path, kind: entry.kind }]
      : [];

  /** The entries an action on `entry` applies to: the selection when it is in it. */
  actionTargets = (entry: FilesystemProjectEntry): FilesystemProjectEntry[] => {
    if (this.selection.ids.has(entry.path) && this.selection.ids.size > 1) {
      const entries = topLevelPaths([...this.selection.ids]).flatMap((path) => {
        const found = this.findEntry(path);
        return found ? [found] : [];
      });
      if (entries.length > 0) return entries;
    }
    return [entry];
  };

  pasteTargetFor = (entry: FilesystemProjectEntry): string =>
    entry.kind === "directory" && !entry.symlink
      ? entry.path
      : parentPath(entry.path);

  // ----- Activation and expansion -----------------------------------------

  activate = (item: FileExplorerTreeItem): void => {
    const active = this.#deps.activeProject();
    if (!active) return;
    if (item.type === "entry" && item.entry.kind === "file") {
      void openFilePane({ projectId: active.id, path: item.entry.path });
      return;
    }
    activateFileExplorerItem(active.id, item);
  };

  /** Expansion changes monitor demand, so every expand/collapse path goes through here. */
  setExpanded = (item: FileExplorerTreeItem, expanded: boolean): void => {
    const active = this.#deps.activeProject();
    if (!active) return;
    setFileExplorerItemExpanded(active.id, item, expanded);
    this.syncMonitorDemand();
  };

  expandPath = (path: string): void => {
    const entry = this.findEntry(path);
    if (entry) this.setExpanded({ type: "entry", entry }, true);
  };

  openFromMenu = (item: FileExplorerEntryItem): void => {
    const active = this.#deps.activeProject();
    const project = this.project;
    if (!active || !project) return;
    if (item.entry.kind === "file") {
      void openFilePane({ projectId: active.id, path: item.entry.path });
      return;
    }
    if (item.entry.kind === "directory") {
      const id = fileExplorerEntryNodeId(active.id, item.entry.path);
      this.setExpanded(item, !project.expandedIds.has(id));
    }
  };

  // ----- Native actions ----------------------------------------------------

  copyText = async (text: string): Promise<void> => {
    try {
      await writeClipboardText(text);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  };

  async runNativeAction(
    action: "openProjectEntry" | "revealProjectEntry",
    entry: FilesystemProjectEntry,
  ): Promise<void> {
    const active = this.#deps.activeProject();
    if (!active) return;
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      await bridge.files[action]({
        projectId: active.id,
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

  // ----- Inline create and rename -----------------------------------------

  async focusRow(path: string): Promise<void> {
    await tick();
    await this.treeController?.revealRow(this.nodeId(path));
  }

  requestCreate = (
    kind: "file" | "directory",
    parent: FilesystemProjectEntry,
  ): void => {
    const active = this.#deps.activeProject();
    if (!active) return;
    this.filterText = "";
    if (parent.path) this.setExpanded({ type: "entry", entry: parent }, true);
    this.editing = { mode: "create", parentPath: parent.path, kind };
    void tick().then(() =>
      this.treeController?.revealRow(
        `file-editor:${this.#deps.activeProject()?.id}:${parent.path}`,
        { focus: false },
      ),
    );
  };

  requestRename = (entry: FilesystemProjectEntry): void => {
    if (entry.path === "") return;
    this.editing = { mode: "rename", entry };
    void tick().then(() =>
      this.treeController?.revealRow(this.nodeId(entry.path), { focus: false }),
    );
  };

  cancelEdit = (): void => {
    const previous = this.editing;
    this.editing = undefined;
    if (previous?.mode === "rename") void this.focusRow(previous.entry.path);
    else if (previous?.parentPath) void this.focusRow(previous.parentPath);
  };

  commitEdit = async (
    item: FileExplorerTreeItem,
    name: string,
  ): Promise<void> => {
    const context = this.operationContext;
    const current = this.editing;
    const active = this.#deps.activeProject();
    this.editing = undefined;
    if (!context || !active) return;
    if (item.type === "editor" && item.mode === "create") {
      try {
        const entry = await createFileExplorerEntry(
          context,
          item.parentPath,
          item.kind,
          name,
        );
        this.selection = selectOnly(entry.path);
        if (item.kind === "file")
          await openFilePane({ projectId: active.id, path: entry.path });
        void this.focusRow(entry.path);
        notify.success(
          item.kind === "file" ? "File created" : "Folder created",
          { description: entry.path, activity: true },
        );
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
        this.selection = selectOnly(to);
        void this.focusRow(to);
      } else void this.focusRow(from);
    }
  };

  // ----- Clipboard, duplicate, delete, mention -----------------------------

  setClipboard = (
    mode: "cut" | "copy",
    entries: FilesystemProjectEntry[],
  ): void => {
    this.clipboard = { mode, entries: entries.flatMap(this.dragItem) };
    if (this.clipboard.entries.length === 0) this.clipboard = undefined;
  };

  pasteInto = async (targetDirectory: string): Promise<void> => {
    const context = this.operationContext;
    const source = this.clipboard;
    if (!context || !source) return;
    if (source.mode === "cut") {
      const plan = planDrop(source.entries, targetDirectory, "move");
      if (!plan.ok) {
        notify.warning(plan.reason);
        return;
      }
      const moved = await moveFileExplorerEntries(context, plan.moves);
      if (moved.length > 0) this.clipboard = undefined;
    } else {
      const plan = planDrop(source.entries, targetDirectory, "copy");
      if (!plan.ok) {
        notify.warning(plan.reason);
        return;
      }
      await copyFileExplorerEntries(
        context,
        planCopyNames(context.projectId, source.entries, targetDirectory),
      );
    }
    if (targetDirectory) this.expandPath(targetDirectory);
  };

  duplicate = async (entries: FilesystemProjectEntry[]): Promise<void> => {
    const context = this.operationContext;
    if (!context) return;
    const byParent = new SvelteMap<string, ProjectEntryDragItem[]>();
    for (const entry of entries) {
      const parent = parentPath(entry.path);
      byParent.set(parent, [
        ...(byParent.get(parent) ?? []),
        ...this.dragItem(entry),
      ]);
    }
    for (const [parent, items] of byParent) {
      const pairs = planCopyNames(context.projectId, items, parent);
      await copyFileExplorerEntries(context, pairs, { verb: "Duplicated" });
    }
  };

  requestDelete = (entries: FilesystemProjectEntry[]): void => {
    const keep = new Set(topLevelPaths(entries.map((entry) => entry.path)));
    const targets = entries.filter((entry) => keep.has(entry.path));
    if (targets.length > 0) this.pendingDelete = targets;
  };

  cancelDelete = (): void => {
    this.pendingDelete = undefined;
  };

  confirmDelete = async (): Promise<void> => {
    const entries = this.pendingDelete;
    const context = this.operationContext;
    this.pendingDelete = undefined;
    if (!entries || !context) return;
    await deleteFileExplorerEntries(context, entries, this.deleteMethod);
    this.selection = emptyFileExplorerSelection;
  };

  mention = (entries: FilesystemProjectEntry[]): void => {
    const references = entries
      .flatMap(this.dragItem)
      .map(formatProjectEntryReference);
    if (!requestComposerMentions(references))
      notify.warning("Open a conversation to mention files");
  };

  // ----- Selection and keyboard -------------------------------------------

  handleItemClick = (
    event: MouseEvent,
    item: FileExplorerTreeItem,
  ): boolean => {
    if (item.type !== "entry") return false;
    const path = item.entry.path;
    if (event.shiftKey) {
      this.selection = selectRange(this.visiblePaths, this.selection, path);
      return true;
    }
    if (event.metaKey || event.ctrlKey) {
      this.selection = toggleSelected(this.selection, path);
      return true;
    }
    this.selection = selectOnly(path);
    return false;
  };

  extendSelection(path: string, direction: 1 | -1): void {
    const paths = this.visiblePaths;
    const index = paths.indexOf(path);
    const neighbor = paths[index + direction];
    if (index < 0 || neighbor === undefined) return;
    const base =
      this.selection.ids.size > 0 ? this.selection : selectOnly(path);
    this.selection = selectRange(paths, base, neighbor);
    void this.treeController?.revealRow(this.nodeId(neighbor));
  }

  handleItemKeydown = (
    event: KeyboardEvent,
    item: FileExplorerTreeItem,
  ): boolean => {
    if (item.type !== "entry") return false;
    const entry = item.entry;
    const action = fileTreeKeyAction(event, this.selection.ids.size > 0);
    switch (action?.type) {
      case undefined:
        return false;
      case "extend":
        this.extendSelection(entry.path, action.direction);
        return true;
      case "rename":
        this.requestRename(entry);
        return true;
      case "delete":
        this.requestDelete(this.actionTargets(entry));
        return true;
      case "clear-selection":
        this.selection = emptyFileExplorerSelection;
        return true;
      case "clipboard":
        this.setClipboard(action.mode, this.actionTargets(entry));
        return true;
      case "paste":
        if (this.clipboard) void this.pasteInto(this.pasteTargetFor(entry));
        return true;
      case "duplicate":
        void this.duplicate(this.actionTargets(entry));
        return true;
      case "select-all":
        this.selection = {
          ids: new Set(this.visiblePaths),
          anchorId: this.visiblePaths[0],
        };
        return true;
    }
  };
}
