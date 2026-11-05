import {
  FILESYSTEM_PROJECT_UPLOAD_MAX_FILES,
  FILESYSTEM_PROJECT_UPLOAD_MAX_FILE_BYTES,
  FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES,
} from "@nervekit/contracts/filesystem";

export type DroppedFile = { file: File; name: string };

/** True when the drag carries OS files (as opposed to tree entries or text). */
export function hasOsFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    success: (file: File) => void,
    failure: (error: Error) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      failure: (error: Error) => void,
    ) => void;
  };
};

async function readAllEntries(
  directory: FileSystemEntryLike,
): Promise<FileSystemEntryLike[]> {
  const reader = directory.createReader?.();
  if (!reader) return [];
  const all: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(
  entry: FileSystemEntryLike,
  prefix: string,
  out: DroppedFile[],
): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) =>
      entry.file?.(resolve, reject),
    );
    out.push({ file, name: `${prefix}${entry.name}` });
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries(entry))
      await walk(child, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Flattens a drop into uploadable files; folders keep their structure through
 * "/" separated names. Must start synchronously inside the drop event, because
 * the DataTransfer is only readable until the handler yields.
 */
export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<DroppedFile[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === "file")
    .map(
      (item) =>
        (
          item as DataTransferItem & {
            webkitGetAsEntry?: () => FileSystemEntryLike | null;
          }
        ).webkitGetAsEntry?.() ?? null,
    );
  const plain = [...dataTransfer.files];
  const out: DroppedFile[] = [];
  if (entries.length > 0 && entries.every((entry) => entry !== null)) {
    for (const entry of entries) if (entry) await walk(entry, "", out);
    return out;
  }
  return plain.map((file) => ({ file, name: file.name }));
}

/** Client-side limit check mirroring the server so the toast is immediate. */
export function uploadLimitError(
  files: readonly DroppedFile[],
): string | undefined {
  if (files.length > FILESYSTEM_PROJECT_UPLOAD_MAX_FILES)
    return `Drop at most ${FILESYSTEM_PROJECT_UPLOAD_MAX_FILES} files at a time.`;
  if (
    files.some(
      ({ file }) => file.size > FILESYSTEM_PROJECT_UPLOAD_MAX_FILE_BYTES,
    )
  )
    return `Files must be ${FILESYSTEM_PROJECT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024} MiB or smaller.`;
  const total = files.reduce((sum, { file }) => sum + file.size, 0);
  if (total > FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES)
    return `Drop at most ${FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024} MiB at a time.`;
  return undefined;
}
