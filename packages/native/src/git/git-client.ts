import { binding } from "../binding/loader.js";
import type {
  NativeGitAncestry,
  NativeGitDocumentSource,
  NativeGitFileDiff,
  NativeGitRepositoryInfo,
  NativeGitSnapshot,
  NativeGitSnapshotOptions,
} from "./contracts.js";
import {
  assertBoundedPath,
  unwrapNative,
  withGitReadOperation,
} from "./read-operation.js";

export async function readGitRepositoryInfo(
  path: string,
): Promise<NativeGitRepositoryInfo> {
  const result = await binding.readGitRepositoryInfo(path);
  return unwrapNative(
    result.repository,
    result.error,
    "Native Git repository info was empty.",
  );
}

/** Bounded and cancellable through `options.signal`; see `NativeGitSnapshotOptions` for limits. */
export async function readGitSnapshot(
  path: string,
  options: NativeGitSnapshotOptions = {},
): Promise<NativeGitSnapshot> {
  assertBoundedPath(path, "Invalid Git snapshot path");
  const { signal, ...native } = options;
  return withGitReadOperation(binding, signal, async (handle) => {
    const result = await binding.readGitSnapshot(path, native, handle);
    return unwrapNative(
      result.snapshot,
      result.error,
      "Native Git snapshot was empty.",
    );
  });
}

export async function checkGitAncestry(
  path: string,
  ancestor: string,
  descendant: string,
): Promise<NativeGitAncestry> {
  const result = await binding.checkGitAncestry(path, ancestor, descendant);
  return unwrapNative(
    result.ancestry,
    result.error,
    "Native Git ancestry was empty.",
  );
}

export async function resolveGitRevision(
  path: string,
  revision: string,
): Promise<string> {
  const result = await binding.resolveGitRevision(path, revision);
  return unwrapNative(
    result.oid,
    result.error,
    "Native Git revision was empty.",
  );
}

/** Commits reachable from HEAD but from no `refs/remotes/<remote>/*` ref. */
export async function countUnpublishedGitCommits(
  path: string,
  remote: string,
): Promise<number> {
  const result = await binding.countUnpublishedGitCommits(path, remote);
  return unwrapNative(
    result.count,
    result.error,
    "Native Git count was empty.",
  );
}

export async function readGitFileDiff(
  path: string,
  original: NativeGitDocumentSource,
  modified: NativeGitDocumentSource,
): Promise<NativeGitFileDiff> {
  const result = await binding.readGitFileDiff(path, original, modified);
  return unwrapNative(
    result.diff,
    result.error,
    "Native Git file diff was empty.",
  );
}

export function validateGitBranchName(name: string): boolean {
  return binding.validateGitBranchName(name);
}
