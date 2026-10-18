export * from "./git-client.js";
export type * from "./contracts.js";
export {
  discoverGitRepositories,
  readGitProjectSnapshots,
} from "./project-client.js";
export type {
  NativeGitDiscovery,
  NativeGitProjectRepository,
  NativeGitStatusCounts,
  NativeGitProjectSnapshot,
  NativeGitProjectRepositoryResult,
  NativeGitProjectReadOptions,
  NativeGitProjectSnapshotOptions,
} from "./project-contracts.js";

export { readGitMetadataSnapshot } from "./metadata-client.js";
