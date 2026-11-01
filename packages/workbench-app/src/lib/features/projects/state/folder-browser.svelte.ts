import {
  createDirectory,
  listDirectories,
  type FilesystemDirectoryResponse,
  type FilesystemLocations,
} from "$lib/api";
import { loadFilesystemLocations } from "./filesystem-locations";
import { parentPath, THIS_PC, type PathContext } from "./folder-browser-path";

export type FolderEntry = FilesystemDirectoryResponse["entries"][number];

/** Where the browser gets places, listings and new folders from. */
export type FolderBrowserSource = {
  locations(): Promise<FilesystemLocations>;
  /** `undefined` asks the daemon for its default folder. */
  list(
    path: string | undefined,
    showHidden: boolean,
  ): Promise<FilesystemDirectoryResponse>;
  create(parent: string, name: string): Promise<{ path: string }>;
};

export const apiFolderBrowserSource: FolderBrowserSource = {
  locations: loadFilesystemLocations,
  list: listDirectories,
  create: createDirectory,
};

const FALLBACK_CONTEXT: PathContext = {
  platform: "other",
  separator: "/",
  home: "",
  caseInsensitive: false,
};

/** Last folder browsed this session; the next open resumes there. */
let lastBrowsedPath: string | undefined;

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * State of the in-app folder browser. All paths are the daemon's; Windows adds
 * a client-side `THIS_PC` level that renders the drive list.
 */
export class FolderBrowser {
  locations = $state<FilesystemLocations>();
  /** Folder shown now. `undefined` until the first load settles. */
  cwd = $state<string>();
  listing = $state<FilesystemDirectoryResponse>();
  loading = $state(false);
  error = $state<string>();
  history = $state<string[]>([]);
  future = $state<string[]>([]);
  filter = $state("");
  showHidden = $state(false);
  selectedPath = $state<string>();
  creating = $state(false);
  createError = $state<string>();
  creatingBusy = $state(false);

  #token = 0;
  readonly #source: FolderBrowserSource;

  constructor(source: FolderBrowserSource = apiFolderBrowserSource) {
    this.#source = source;
  }

  readonly ctx = $derived<PathContext>(this.locations ?? FALLBACK_CONTEXT);
  readonly atThisPC = $derived(this.cwd === THIS_PC);
  readonly parent = $derived(
    this.cwd === undefined || this.atThisPC
      ? undefined
      : (this.listing?.parent ?? parentPath(this.cwd, this.ctx)),
  );
  readonly allEntries = $derived.by<FolderEntry[]>(() => {
    if (this.atThisPC) {
      return (this.locations?.locations ?? []).map((location) => ({
        name: location.label,
        path: location.path,
        kind: "directory" as const,
        hidden: false,
        signals: [],
      }));
    }
    return this.listing?.entries ?? [];
  });
  readonly entries = $derived.by<FolderEntry[]>(() => {
    const query = this.filter.trim().toLowerCase();
    if (!query) return this.allEntries;
    return this.allEntries.filter((entry) =>
      entry.name.toLowerCase().includes(query),
    );
  });
  readonly selectedEntry = $derived(
    this.entries.find((entry) => entry.path === this.selectedPath),
  );
  /** What Open acts on: the selected row, else the folder being viewed. */
  readonly target = $derived(
    this.selectedPath ?? (this.atThisPC ? undefined : this.cwd),
  );
  readonly targetSignals = $derived(
    this.selectedEntry
      ? this.selectedEntry.signals
      : this.selectedPath
        ? []
        : (this.listing?.signals ?? []),
  );

  /** Load the daemon's places once, then open the starting folder. */
  async open(initialPath?: string): Promise<void> {
    this.history = [];
    this.future = [];
    this.filter = "";
    this.selectedPath = undefined;
    this.creating = false;
    if (!this.locations) {
      try {
        this.locations = await this.#source.locations();
      } catch {
        // Browsing still works without places; the listing reports real errors.
      }
    }
    await this.#load(initialPath ?? lastBrowsedPath, "replace");
  }

  /** Navigate to a folder; failures surface as the list's error state. */
  go(path: string): Promise<void> {
    return this.#load(path, "push");
  }

  /**
   * Navigate to a typed path. Resolution is the daemon's: on failure nothing
   * changes and the message is returned for the path field to show.
   */
  async goTyped(path: string): Promise<string | undefined> {
    if (path === THIS_PC && this.ctx.platform === "win32") {
      await this.#load(THIS_PC, "push");
      return undefined;
    }
    try {
      const listing = await this.#source.list(path, this.showHidden);
      this.#commit(listing.path, listing, "push");
      return undefined;
    } catch (caught) {
      return messageOf(caught);
    }
  }

  up(): Promise<void> | undefined {
    return this.parent === undefined ? undefined : this.go(this.parent);
  }

  back(): Promise<void> | undefined {
    const previous = this.history.at(-1);
    if (previous === undefined) return undefined;
    if (this.cwd !== undefined) this.future = [this.cwd, ...this.future];
    this.history = this.history.slice(0, -1);
    return this.#load(previous, "replace");
  }

  forward(): Promise<void> | undefined {
    const next = this.future[0];
    if (next === undefined) return undefined;
    if (this.cwd !== undefined) this.history = [...this.history, this.cwd];
    this.future = this.future.slice(1);
    return this.#load(next, "replace");
  }

  refresh(): Promise<void> {
    return this.#load(this.cwd, "keep");
  }

  setShowHidden(next: boolean): Promise<void> {
    this.showHidden = next;
    return this.#load(this.cwd, "keep");
  }

  select(path: string | undefined): void {
    this.selectedPath = path;
  }

  startCreate(): void {
    if (this.atThisPC || !this.cwd) return;
    this.createError = undefined;
    this.creating = true;
  }

  cancelCreate(): void {
    this.creating = false;
    this.createError = undefined;
  }

  /** Create a subfolder of the current folder and select it. */
  async create(name: string): Promise<void> {
    const parent = this.cwd;
    const trimmed = name.trim();
    if (!parent || this.atThisPC || !trimmed) return;
    this.creatingBusy = true;
    this.createError = undefined;
    try {
      const created = await this.#source.create(parent, trimmed);
      this.creating = false;
      await this.#load(parent, "keep");
      this.selectedPath = created.path;
    } catch (caught) {
      this.createError = messageOf(caught);
    } finally {
      this.creatingBusy = false;
    }
  }

  async #load(
    path: string | undefined,
    mode: "push" | "replace" | "keep",
  ): Promise<void> {
    const token = ++this.#token;
    if (path === THIS_PC) {
      this.#commit(THIS_PC, undefined, mode);
      return;
    }
    this.loading = true;
    this.error = undefined;
    try {
      const listing = await this.#source.list(path, this.showHidden);
      if (token !== this.#token) return;
      this.#commit(listing.path, listing, mode);
    } catch (caught) {
      if (token !== this.#token) return;
      this.listing = undefined;
      this.error = messageOf(caught);
      if (path !== undefined) {
        if (mode === "push" && this.cwd !== undefined) {
          this.history = [...this.history, this.cwd];
          this.future = [];
        }
        this.cwd = path;
      }
      this.selectedPath = undefined;
    } finally {
      if (token === this.#token) this.loading = false;
    }
  }

  #commit(
    path: string,
    listing: FilesystemDirectoryResponse | undefined,
    mode: "push" | "replace" | "keep",
  ): void {
    this.#token += 1;
    if (mode === "push" && this.cwd !== undefined && this.cwd !== path) {
      this.history = [...this.history, this.cwd];
      this.future = [];
    }
    if (mode !== "keep") {
      this.filter = "";
      this.selectedPath = undefined;
    } else if (
      this.selectedPath &&
      !listing?.entries.some((entry) => entry.path === this.selectedPath)
    ) {
      this.selectedPath = undefined;
    }
    this.cwd = path;
    this.listing = listing;
    this.error = undefined;
    this.loading = false;
    if (path !== THIS_PC) lastBrowsedPath = path;
  }
}
