import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import { notify } from "$lib/application/notifications/notify.svelte";
import { ApiRequestError } from "$lib/platform/http/api-client";
import {
  formatProjectEntryReference,
  PROJECT_ENTRY_DRAG_MIME,
  serializeProjectEntryDrag,
  type ProjectEntryDragItem,
} from "$lib/presentation/dnd/project-entry-drag";
import { uploadProjectFiles } from "../api/filesystem.api";
import {
  collectDroppedFiles,
  hasOsFiles,
  uploadLimitError,
  type DroppedFile,
} from "./file-explorer-drop";
import {
  copyFileExplorerEntries,
  moveFileExplorerEntries,
  planCopyNames,
  type FileOperationContext,
} from "./file-explorer-operations.svelte";
import { planDrop } from "./file-explorer-paths";
import type { FileExplorerTreeItem } from "./file-explorer-tree";
import { describeFileOperationError } from "./file-operation-errors";

const AUTO_EXPAND_DELAY_MS = 600;

export type FilesTreeDragDependencies = {
  projectId: () => string | undefined;
  operationContext: () => FileOperationContext | undefined;
  actionTargets(entry: FilesystemProjectEntry): FilesystemProjectEntry[];
  dragItem(entry: FilesystemProjectEntry): ProjectEntryDragItem[];
  pasteTargetFor(entry: FilesystemProjectEntry): string;
  isSelected(path: string): boolean;
  selectOnly(path: string): void;
  isExpanded(directory: string): boolean;
  expandPath(path: string): void;
  refreshDirectories(directories: string[]): Promise<void>;
};

/** Drag-and-drop (move, copy, OS-file upload) state and handlers for the files tree. */
export class FilesTreeDrag {
  dropTargetPath = $state<string>();
  rootDropActive = $state(false);
  externalDropHint = $state(false);
  pendingReplace = $state<{
    parent: string;
    files: DroppedFile[];
    message: string;
  }>();

  #sources: ProjectEntryDragItem[] | undefined;
  #autoExpand:
    | { path: string; timer: ReturnType<typeof setTimeout> }
    | undefined;
  readonly #deps: FilesTreeDragDependencies;

  constructor(deps: FilesTreeDragDependencies) {
    this.#deps = deps;
  }

  start = (event: DragEvent, item: FileExplorerTreeItem): void => {
    if (item.type !== "entry" || !event.dataTransfer) return;
    const targets = this.#deps.actionTargets(item.entry);
    const entries = targets.flatMap(this.#deps.dragItem);
    if (entries.length === 0) return;
    if (!this.#deps.isSelected(item.entry.path))
      this.#deps.selectOnly(item.entry.path);
    this.#sources = entries;
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
  };

  clear = (): void => {
    this.#sources = undefined;
    this.dropTargetPath = undefined;
    this.rootDropActive = false;
    this.externalDropHint = false;
    if (this.#autoExpand) clearTimeout(this.#autoExpand.timer);
    this.#autoExpand = undefined;
  };

  #dropDirectoryFor(item: FileExplorerTreeItem): string | undefined {
    if (item.type !== "entry") return undefined;
    return this.#deps.pasteTargetFor(item.entry);
  }

  #highlight(directory: string): void {
    this.rootDropActive = directory === "";
    this.dropTargetPath = directory === "" ? undefined : directory;
    if (!directory || this.#autoExpand?.path === directory) return;
    if (this.#autoExpand) clearTimeout(this.#autoExpand.timer);
    this.#autoExpand = this.#deps.isExpanded(directory)
      ? undefined
      : {
          path: directory,
          timer: setTimeout(
            () => this.#deps.expandPath(directory),
            AUTO_EXPAND_DELAY_MS,
          ),
        };
  }

  /** Accepts a drag over `directory` when it is a valid move/copy/upload there. */
  #accept(event: DragEvent, directory: string): boolean {
    if (!event.dataTransfer) return false;
    const types = [...event.dataTransfer.types];
    if (this.#sources) {
      const copy = event.altKey;
      const plan = planDrop(this.#sources, directory, copy ? "copy" : "move");
      if (!plan.ok) {
        event.dataTransfer.dropEffect = "none";
        this.dropTargetPath = undefined;
        this.rootDropActive = false;
        return false;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = copy ? "copy" : "move";
    } else if (hasOsFiles(types)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      this.externalDropHint = true;
    } else {
      return false;
    }
    this.#highlight(directory);
    return true;
  }

  itemOver = (event: DragEvent, item: FileExplorerTreeItem): void => {
    const directory = this.#dropDirectoryFor(item);
    if (directory === undefined) return;
    event.stopPropagation();
    this.#accept(event, directory);
  };

  rootOver = (event: DragEvent): void => {
    this.#accept(event, "");
  };

  rootLeave = (event: DragEvent): void => {
    const related = event.relatedTarget;
    if (
      related instanceof Node &&
      (event.currentTarget as Node).contains(related)
    )
      return;
    this.dropTargetPath = undefined;
    this.rootDropActive = false;
    this.externalDropHint = false;
  };

  drop = async (event: DragEvent, directory: string): Promise<void> => {
    const context = this.#deps.operationContext();
    const dataTransfer = event.dataTransfer;
    const sources = this.#sources;
    const copy = event.altKey;
    if (!context || !dataTransfer) return;
    if (sources) {
      event.preventDefault();
      this.clear();
      const plan = planDrop(sources, directory, copy ? "copy" : "move");
      if (!plan.ok) {
        notify.warning(plan.reason);
        return;
      }
      if (copy)
        await copyFileExplorerEntries(
          context,
          planCopyNames(context.projectId, sources, directory),
        );
      else await moveFileExplorerEntries(context, plan.moves);
      if (directory) this.#deps.expandPath(directory);
      return;
    }
    if (hasOsFiles([...dataTransfer.types])) {
      event.preventDefault();
      this.clear();
      const files = await collectDroppedFiles(dataTransfer);
      await this.upload(directory, files);
    }
  };

  itemDrop = (event: DragEvent, item: FileExplorerTreeItem): void => {
    const directory = this.#dropDirectoryFor(item);
    if (directory === undefined) return;
    event.stopPropagation();
    void this.drop(event, directory);
  };

  async upload(
    directory: string,
    files: DroppedFile[],
    overwrite = false,
  ): Promise<void> {
    const projectId = this.#deps.projectId();
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
      await this.#deps.refreshDirectories([directory]);
      if (directory) this.#deps.expandPath(directory);
      notify.success(
        response.entries.length === 1
          ? `Added “${response.entries[0]?.name}”`
          : `Added ${response.entries.length} files`,
        { activity: true },
      );
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        caught.code === "PROJECT_ENTRY_EXISTS"
      ) {
        this.pendingReplace = {
          parent: directory,
          files,
          message: caught.message,
        };
        return;
      }
      notify.error("Could not add files", {
        description: describeFileOperationError(caught),
      });
    }
  }

  confirmReplace = (): void => {
    const pending = this.pendingReplace;
    this.pendingReplace = undefined;
    if (pending) void this.upload(pending.parent, pending.files, true);
  };

  cancelReplace = (): void => {
    this.pendingReplace = undefined;
  };
}
