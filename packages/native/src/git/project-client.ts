import { withGitReadOperation } from "./read-operation.js";
import { binding } from "../binding/loader.js";
import { normalizeNativeError } from "../core/error.js";
import type {
  NativeGitDiscovery,
  NativeGitProjectBinding,
  NativeGitProjectReadOptions,
  NativeGitProjectRepository,
  NativeGitProjectRepositoryResult,
  NativeGitProjectSnapshotOptions,
} from "./project-contracts.js";

function fail(
  category: "invalid_input" | "cancelled" | "internal",
  message: string,
): never {
  throw normalizeNativeError({ category, message, retryable: false });
}

/** Internal injectable owner of admission and cancellation wiring (not a root export). */
export function createGitProjectReader(port: NativeGitProjectBinding) {
  return {
    async discoverGitRepositories(
      root: string,
      options: NativeGitProjectReadOptions = {},
    ): Promise<NativeGitDiscovery> {
      if (
        typeof root !== "string" ||
        !root ||
        Buffer.byteLength(root) > 4096 ||
        root.includes("\0")
      )
        fail("invalid_input", "Invalid project root");
      return withGitReadOperation(port, options.signal, async (handle) => {
        const result = await port.discoverGitRepositories(root, handle);
        if (result.error) throw normalizeNativeError(result.error);
        if (!result.discovery)
          fail("internal", "Native Git discovery was empty");
        return result.discovery;
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
          if (
            typeof path !== "string" ||
            !path ||
            Buffer.byteLength(path) > 4096 ||
            path.includes("\0")
          )
            fail("invalid_input", "Invalid Git repository descriptor");
        }
      }
      return withGitReadOperation(port, options.signal, async (handle) => {
        const result = await port.readGitProjectSnapshots(
          repositories,
          options.includeIgnored ?? false,
          handle,
        );
        if (result.error) throw normalizeNativeError(result.error);
        if (!result.repositories)
          fail("internal", "Native Git project snapshots were empty");
        return result.repositories;
      });
    },
  };
}

const reader = createGitProjectReader(binding);
export const discoverGitRepositories = reader.discoverGitRepositories;
export const readGitProjectSnapshots = reader.readGitProjectSnapshots;
