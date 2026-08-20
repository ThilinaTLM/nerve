import { binding } from "../binding/loader.js";
import type {
  NativeGitAncestry,
  NativeGitDocumentSource,
  NativeGitErrorCategory,
  NativeGitErrorDetail,
  NativeGitFileDiff,
  NativeGitRepositoryInfo,
  NativeGitSnapshot,
  NativeGitSnapshotOptions,
} from "./types.js";

export class NativeGitReadError extends Error {
  constructor(
    readonly category: NativeGitErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "NativeGitReadError";
  }
}

export async function readGitRepositoryInfo(
  path: string,
): Promise<NativeGitRepositoryInfo> {
  const result = await binding.readGitRepositoryInfo(path);
  if (result.error) throw nativeGitError(result.error);
  if (!result.repository)
    throw new NativeGitReadError(
      "internal",
      "Native Git repository info was empty.",
    );
  return result.repository;
}

export async function readGitSnapshot(
  path: string,
  options?: NativeGitSnapshotOptions,
): Promise<NativeGitSnapshot> {
  const result = await binding.readGitSnapshot(path, options);
  if (result.error) throw nativeGitError(result.error);
  if (!result.snapshot)
    throw new NativeGitReadError("internal", "Native Git snapshot was empty.");
  return result.snapshot;
}

export async function checkGitAncestry(
  path: string,
  ancestor: string,
  descendant: string,
): Promise<NativeGitAncestry> {
  const result = await binding.checkGitAncestry(path, ancestor, descendant);
  if (result.error) throw nativeGitError(result.error);
  if (!result.ancestry)
    throw new NativeGitReadError("internal", "Native Git ancestry was empty.");
  return result.ancestry;
}

export async function resolveGitRevision(
  path: string,
  revision: string,
): Promise<string> {
  const result = await binding.resolveGitRevision(path, revision);
  if (result.error) throw nativeGitError(result.error);
  if (!result.oid)
    throw new NativeGitReadError("internal", "Native Git revision was empty.");
  return result.oid;
}

export async function readGitFileDiff(
  path: string,
  original: NativeGitDocumentSource,
  modified: NativeGitDocumentSource,
): Promise<NativeGitFileDiff> {
  const result = await binding.readGitFileDiff(path, original, modified);
  if (result.error) throw nativeGitError(result.error);
  if (!result.diff)
    throw new NativeGitReadError("internal", "Native Git file diff was empty.");
  return result.diff;
}

export function validateGitBranchName(name: string): boolean {
  return binding.validateGitBranchName(name);
}

function nativeGitError(detail: NativeGitErrorDetail): NativeGitReadError {
  return new NativeGitReadError(detail.category, detail.message);
}
