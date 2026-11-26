import {
  assertBoundedPath,
  fail,
  unwrapNative,
  withGitReadOperation,
} from "./read-operation.js";
import { binding } from "../binding/loader.js";
import type {
  NativeGitDiscovery,
  NativeGitProjectBinding,
  NativeGitProjectReadOptions,
  NativeGitProjectRepository,
  NativeGitProjectRepositoryResult,
  NativeGitProjectSnapshotOptions,
} from "./project-contracts.js";

/** Internal injectable owner of admission and cancellation wiring (not a root export). */
export function createGitProjectReader(port: NativeGitProjectBinding) {
  return {
    async discoverGitRepositories(
      root: string,
      options: NativeGitProjectReadOptions = {},
    ): Promise<NativeGitDiscovery> {
      assertBoundedPath(root, "Invalid project root");
      return withGitReadOperation(port, options.signal, async (handle) => {
        const result = await port.discoverGitRepositories(root, handle);
        return unwrapNative(
          result.discovery,
          result.error,
          "Native Git discovery was empty",
        );
      });
    },
    async readGitProjectSnapshots(
      repositories: NativeGitProjectRepository[],
      options: NativeGitProjectSnapshotOptions = {},
    ): Promise<NativeGitProjectRepositoryResult[]> {
      if (!Array.isArray(repositories) || repositories.length > 128)
        fail("invalid_input", "At most 128 repositories per Git read");
      // Validate before N-API copies the input. Native checks remain authoritative.
      for (const repository of repositories) {
        if (!repository || typeof repository !== "object")
          fail("invalid_input", "Invalid Git repository descriptor");
        for (const path of [
          repository.relativePath,
          repository.workDir,
          repository.gitDir,
          repository.commonDir,
        ]) {
          assertBoundedPath(path, "Invalid Git repository descriptor");
        }
      }
      return withGitReadOperation(port, options.signal, async (handle) => {
        const result = await port.readGitProjectSnapshots(
          repositories,
          options.includeIgnored ?? false,
          handle,
        );
        return unwrapNative(
          result.repositories,
          result.error,
          "Native Git project snapshots were empty",
        );
      });
    },
  };
}

const reader = createGitProjectReader(binding);
export const discoverGitRepositories = reader.discoverGitRepositories;
export const readGitProjectSnapshots = reader.readGitProjectSnapshots;
