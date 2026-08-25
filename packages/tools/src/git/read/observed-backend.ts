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
      return await this.run("repository-info", () =>
        this.backend.isRepository(repoDir),
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
    return this.run("snapshot", () =>
      this.backend.snapshot(repoDir, includeIgnored),
    );
  }
  isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return this.run("ancestry", () =>
      this.backend.isAncestor(repoDir, ancestor, descendant),
    );
  }
  resolveRevision(repoDir: string, revision: string): Promise<string> {
    return this.run("resolve-revision", () =>
      this.backend.resolveRevision(repoDir, revision),
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
    return this.run("file-diff", () =>
      this.backend.fileDiff(repoDir, original, modified),
    );
  }

  private async run<T>(
    operation: string,
    invoke: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await invoke();
      this.report({
        backend: "native",
        operation,
        durationMs: performance.now() - startedAt,
        succeeded: true,
      });
      return result;
    } catch (error) {
      this.report({
        backend: "native",
        operation,
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
