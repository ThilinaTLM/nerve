import { binding } from "../binding/loader.js";
import type { NativeFilesBinding, NativePathIndexHandle } from "./binding.js";
import type {
  ContentSearchOptions,
  ContentSearchResult,
  DirectoryEntry,
  ListDirectoryOptions,
  PathIndex,
  PathIndexKind,
  PathIndexOptions,
  PathIndexQueryOptions,
  PathIndexResult,
} from "./contracts.js";

export type * from "./contracts.js";

const files = binding as typeof binding & NativeFilesBinding;

/**
 * True when the loaded addon includes the ignore-aware files domain. Callers
 * must fall back to their Node implementation when this is false.
 */
export function isAvailable(): boolean {
  return (
    [
      "listProjectDirectory",
      "createFilePathIndex",
      "searchFilePathIndex",
      "applyFilePathIndexChanges",
      "rebuildFilePathIndex",
      "closeFilePathIndex",
      "searchFileContent",
      "cancelFileContentSearch",
    ] as const
  ).every((name) => typeof files[name] === "function");
}

function required<K extends keyof NativeFilesBinding>(
  name: K,
): NonNullable<NativeFilesBinding[K]> {
  const member = files[name];
  if (typeof member !== "function")
    throw new Error(`Native files support is not available (${name})`);
  return member.bind(files) as NonNullable<NativeFilesBinding[K]>;
}

export async function listDirectory(
  root: string,
  relativePath: string,
  options: ListDirectoryOptions = {},
): Promise<DirectoryEntry[]> {
  return required("listProjectDirectory")(
    root,
    relativePath,
    options.includeHidden ?? true,
  );
}

export function createPathIndex(
  root: string,
  options: PathIndexOptions = {},
): PathIndex {
  const handle: NativePathIndexHandle = required("createFilePathIndex")(
    root,
    options.maxEntries,
  );
  let closed = false;
  const open = (): void => {
    if (closed) throw new Error("Path index is closed");
  };
  const finalizerToken = {};
  const index: PathIndex = {
    async search(
      query: string,
      queryOptions: PathIndexQueryOptions = {},
    ): Promise<PathIndexResult> {
      open();
      const kinds: PathIndexKind[] | undefined = queryOptions.kinds;
      return required("searchFilePathIndex")(
        handle,
        query,
        queryOptions.limit ?? 50,
        kinds,
      );
    },
    async applyChanges(changedPaths: string[]): Promise<void> {
      open();
      if (changedPaths.length === 0) return;
      await required("applyFilePathIndexChanges")(handle, changedPaths);
    },
    async rebuild(): Promise<void> {
      open();
      required("rebuildFilePathIndex")(handle);
    },
    close(): void {
      if (closed) return;
      closed = true;
      pathIndexFinalizer.unregister(finalizerToken);
      required("closeFilePathIndex")(handle);
    },
  };
  pathIndexFinalizer.register(index, handle, finalizerToken);
  return index;
}

const pathIndexFinalizer = new FinalizationRegistry<NativePathIndexHandle>(
  (handle) => {
    try {
      files.closeFilePathIndex?.(handle);
    } catch {
      // Already closed.
    }
  },
);

let nextCancelId = 1;

export async function searchContent(
  root: string,
  options: ContentSearchOptions,
): Promise<ContentSearchResult> {
  const search = required("searchFileContent");
  const { signal, ...request } = options;
  signal?.throwIfAborted();
  const cancelId = nextCancelId++;
  const onAbort = (): void => files.cancelFileContentSearch?.(cancelId);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await search(root, { ...request, cancelId });
    signal?.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
