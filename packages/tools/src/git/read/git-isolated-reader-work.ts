import type {
  NativeGitDiscovery,
  NativeGitSnapshot,
  NativeGitSnapshotOptions,
} from "@nervekit/native";
import {
  categoryOf,
  isolatedError,
  lightGitIsolatedSnapshot,
  sameGitIsolatedIdentity,
  type GitIsolatedFrame,
  type GitIsolatedInput,
} from "./git-isolated-reader-protocol.js";

export interface GitIsolatedReadPort {
  discover(path: string): Promise<NativeGitDiscovery>;
  snapshot(
    path: string,
    options: NativeGitSnapshotOptions,
  ): Promise<NativeGitSnapshot>;
  canonicalPath(path: string): Promise<string>;
}

/** Helper orchestration only. All Git reads use the same native kernel. The
 * expected identity is checked BEFORE any detailed read can execute a filter.
 * App lanes exclude app mutations; external filesystem changes can still race
 * the pre/post checks. This is not a transactional filesystem snapshot. */
export async function readGitIsolatedFrame(
  input: GitIsolatedInput,
  port: GitIsolatedReadPort,
  platform: NodeJS.Platform = process.platform,
): Promise<GitIsolatedFrame> {
  try {
    const path = input.expected.workDir; // Never rewrite I/O paths to comparison keys.
    const discovery = await port.discover(path);
    const identity = discovery.repositories[0];
    if (
      !discovery.projectIsRepo ||
      discovery.repositories.length !== 1 ||
      !identity
    )
      return { version: 1, ok: false, error: isolatedError("not_repository") };
    if (!sameGitIsolatedIdentity(identity, input.expected, platform))
      return { version: 1, ok: false, error: isolatedError("invalid_input") };
    const detailed = await port.snapshot(path, {
      includeIgnored: input.includeIgnored,
      statusLimit: 20_000,
      recentCommitLimit: 0,
      stashLimit: 0,
    });
    const after = (await port.discover(path)).repositories[0];
    if (
      !after ||
      !sameGitIsolatedIdentity(after, input.expected, platform) ||
      !detailed.workDir
    )
      return { version: 1, ok: false, error: isolatedError("invalid_input") };
    // Node and Rust Windows canonical spellings differ. Use C's shared key
    // implementation, not raw string comparison or a second Windows normalizer.
    const observed = {
      workDir: await port.canonicalPath(detailed.workDir),
      gitDir: await port.canonicalPath(detailed.gitDir),
      commonDir: after.commonDir,
    };
    if (!sameGitIsolatedIdentity(observed, input.expected, platform))
      return { version: 1, ok: false, error: isolatedError("invalid_input") };
    return {
      version: 1,
      ok: true,
      identity: {
        workDir: identity.workDir,
        gitDir: identity.gitDir,
        commonDir: identity.commonDir,
      },
      snapshot: lightGitIsolatedSnapshot(detailed),
    };
  } catch (error) {
    return { version: 1, ok: false, error: isolatedError(categoryOf(error)) };
  }
}
