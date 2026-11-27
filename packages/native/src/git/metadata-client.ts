import { binding } from "../binding/loader.js";
import type {
  NativeGitMetadataSnapshot,
  NativeGitMetadataSnapshotOptions,
} from "./contracts.js";
import {
  assertBoundedPath,
  fail,
  unwrapNative,
  withGitReadOperation,
} from "./read-operation.js";
import type { NativeGitMetadataBinding } from "./binding.js";
/** Injectable lifecycle owner; not a package-root export. */
export function createGitMetadataReader(port: NativeGitMetadataBinding) {
  return async function readGitMetadataSnapshot(
    path: string,
    options: NativeGitMetadataSnapshotOptions = {},
  ): Promise<NativeGitMetadataSnapshot> {
    assertBoundedPath(path, "Invalid Git metadata path");
    const selected: Omit<NativeGitMetadataSnapshotOptions, "signal"> = {};
    for (const key of [
      "refLimit",
      "recentCommitLimit",
      "stashLimit",
    ] as const) {
      const value = options[key];
      if (value !== undefined) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
          fail("invalid_input", "Invalid Git metadata count limit");
        selected[key] = value;
      }
    }
    return withGitReadOperation(port, options.signal, async (handle) => {
      const result = await port.readGitMetadataSnapshot(path, selected, handle);
      return unwrapNative(
        result.snapshot,
        result.error,
        "Native Git metadata was empty",
      );
    });
  };
}
/** Cancellable metadata read. Limits fail explicitly rather than truncate. */
export const readGitMetadataSnapshot = createGitMetadataReader(binding);
