import {
  NativeGitReadError,
  type NativeGitDocumentSource,
  type NativeGitFileDiff,
} from "@nervekit/native";
import type { GitReadObservation } from "../git-observability.js";
import type { GitReadBackend, GitReadSnapshot } from "./types.js";

export class ObservedGitReadBackend implements GitReadBackend {
  constructor(
    private readonly backend: GitReadBackend,
    private readonly observe?: (observation: GitReadObservation) => void,
  ) {}

  async isRepository(repoDir: string): Promise<boolean> {
    try {
      return await this.run(
        "repository-info",
        () => this.backend.isRepository(repoDir),
        repoDir,
      );
    } catch (error) {
      if (
        error instanceof NativeGitReadError &&
        error.category === "not_repository"
      )
        return false;
      throw error;
    }
  }
  snapshot(
    repoDir: string,
    includeIgnored?: boolean,
  ): Promise<GitReadSnapshot> {
    return this.run(
      "snapshot",
      () => this.backend.snapshot(repoDir, includeIgnored),
      repoDir,
    );
  }
  isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return this.run(
      "ancestry",
      () => this.backend.isAncestor(repoDir, ancestor, descendant),
      repoDir,
    );
  }
  resolveRevision(repoDir: string, revision: string): Promise<string> {
    return this.run(
      "resolve-revision",
      () => this.backend.resolveRevision(repoDir, revision),
      repoDir,
    );
  }
  validateBranchName(name: string): Promise<boolean> {
    return this.run("validate-branch", () =>
      this.backend.validateBranchName(name),
    );
  }
  fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff> {
    return this.run(
      "file-diff",
      () => this.backend.fileDiff(repoDir, original, modified),
      repoDir,
    );
  }

  private async run<T>(
    operation: string,
    invoke: () => Promise<T>,
    repoDir?: string,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await invoke();
      this.report({
        backend: "native",
        operation,
        repoDir,
        durationMs: performance.now() - startedAt,
        succeeded: true,
      });
      return result;
    } catch (error) {
      this.report({
        backend: "native",
        operation,
        repoDir,
        durationMs: performance.now() - startedAt,
        succeeded: false,
      });
      throw error;
    }
  }

  private report(observation: GitReadObservation): void {
    try {
      this.observe?.(observation);
    } catch {
      /* Diagnostics cannot affect reads. */
    }
  }
}
