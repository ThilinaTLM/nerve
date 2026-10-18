import { binding } from "../binding/loader.js";
import { normalizeNativeError } from "../core/error.js";
import type {
  NativeGitMetadataSnapshot,
  NativeGitMetadataSnapshotOptions,
} from "./contracts.js";
import { withGitReadOperation } from "./read-operation.js";
import type { NativeGitMetadataBinding } from "./binding.js";
/** Injectable lifecycle owner; not a package-root export. */
export function createGitMetadataReader(port: NativeGitMetadataBinding) {
  return async function readGitMetadataSnapshot(
    path: string,
    options: NativeGitMetadataSnapshotOptions = {},
  ): Promise<NativeGitMetadataSnapshot> {
    if (
      typeof path !== "string" ||
      !path ||
      Buffer.byteLength(path) > 4096 ||
      path.includes("\0")
    )
      throw normalizeNativeError({
        category: "invalid_input",
        message: "Invalid Git metadata path",
        retryable: false,
      });
    const selected: Omit<NativeGitMetadataSnapshotOptions, "signal"> = {};
    for (const key of [
      "refLimit",
      "recentCommitLimit",
      "stashLimit",
    ] as const) {
      const value = options[key];
      if (value !== undefined) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
          throw normalizeNativeError({
            category: "invalid_input",
            message: "Invalid Git metadata count limit",
            retryable: false,
          });
        selected[key] = value;
      }
    }
    return withGitReadOperation(port, options.signal, async (handle) => {
      const result = await port.readGitMetadataSnapshot(path, selected, handle);
      if (result.error) throw normalizeNativeError(result.error);
      if (!result.snapshot)
        throw normalizeNativeError({
          category: "internal",
          message: "Native Git metadata was empty",
          retryable: false,
        });
      return result.snapshot;
    });
  };
}
/** Cancellable metadata read. Limits fail explicitly rather than truncate. */
export const readGitMetadataSnapshot = createGitMetadataReader(binding);
