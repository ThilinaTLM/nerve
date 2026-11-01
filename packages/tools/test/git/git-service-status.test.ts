import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { GitService } from "../../src/git/git-service.js";

type FileStatus = Awaited<
  ReturnType<GitService["projectFileStatus"]>
>["files"][number];

function file(
  path: string,
  index: FileStatus["index"],
  worktree: FileStatus["worktree"],
  untracked = false,
) {
  return { path, index, worktree, staged: false, untracked };
}

function statusBackend(
  files: (repoDir: string) => Promise<ReturnType<typeof file>[]>,
  paths?: string[],
) {
  const snapshot = async (repoDir: string) => ({
    headOid: "abcdef",
    branch: {
      head: "main",
      detached: false,
      upstream: null,
      ahead: null,
      behind: null,
    },
    refs: [],
    remotes: [],
    files: await files(repoDir),
    recentCommits: [],
    stashes: [],
  });
  return {
    async close() {},
    snapshot,
    metadata: snapshot,
    isRepository: async () => true,
    fileDiff: async () => {
      throw new Error("not used");
    },
    discoverProject: async (root: string) => ({
      root,
      projectIsRepo: !paths,
      repositories: (paths ?? [root]).map((workDir) => ({
        relativePath: relative(root, workDir).split(sep).join("/") || ".",
        workDir,
        gitDir: join(workDir, ".git"),
        commonDir: join(workDir, ".git"),
      })),
    }),
    projectSnapshots: async (
      repositories: Array<{
        relativePath: string;
        workDir: string;
        gitDir: string;
        commonDir: string;
      }>,
    ) =>
      Promise.all(
        repositories.map(async (repository) => ({
          repository,
          snapshot: {
            ...(await snapshot(repository.workDir)),
            inProgress: [],
            counts: {
              staged: 0,
              unstaged: 0,
              untracked: 0,
              ignored: 0,
              conflicted: 0,
            },
          },
        })),
      ),
    isAncestor: async () => false,
    resolveRevision: async (_repoDir: string, revision: string) => revision,
    countUnpublishedCommits: async () => 0,
    validateBranchName: async () => true,
  };
}

describe("GitService project file status", () => {
  it("returns project-relative paths for a root repository", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "nerve-git-status-")),
    );
    try {
      const service = new GitService(() => ({ dir: root, name: "repo" }), {
        readBackend: statusBackend(async (repoDir) => {
          assert.equal(repoDir, root);
          return [
            file("new.ts", "?", "?", true),
            file("modified.ts", " ", "M"),
            file("generated/", "!", "!"),
          ];
        }),
      });

      const result = await service.projectFileStatus("proj_test");
      assert.deepEqual(
        result.files.map((file) => [file.repo, file.path]),
        [
          [".", "generated"],
          [".", "modified.ts"],
          [".", "new.ts"],
        ],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefixes paths from nested repositories", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "nerve-git-status-")),
    );
    try {
      await mkdir(join(root, "packages", "app", ".git"), { recursive: true });
      const service = new GitService(() => ({ dir: root, name: "project" }), {
        readBackend: statusBackend(
          async (repoDir) => {
            assert.equal(repoDir, join(root, "packages", "app"));
            return [file("src/index.ts", "?", "?", true)];
          },
          [join(root, "packages", "app")],
        ),
      });

      const result = await service.projectFileStatus("proj_test");
      assert.equal(result.files[0]?.repo, "packages/app");
      assert.equal(result.files[0]?.path, "packages/app/src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

void it("shares discovery/batch results between listing and status and exposes per-repo failures", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "nerve-shared-git-read-")),
  );
  try {
    let discoveries = 0;
    let batches = 0;
    const backend = statusBackend(
      async () => [file("current.ts", "R", " ")],
      [join(root, "a"), join(root, "b")],
    );
    const discover = backend.discoverProject;
    const batch = backend.projectSnapshots;
    backend.discoverProject = async (path) => {
      discoveries++;
      return discover(path);
    };
    backend.projectSnapshots = async (repos) => {
      batches++;
      const rows = await batch(repos);
      return rows.map((row) =>
        row.repository.relativePath === "b"
          ? {
              repository: row.repository,
              error: {
                category: "io",
                message: "raw private path",
                retryable: true,
              },
            }
          : row,
      ) as typeof rows;
    };
    const service = new GitService(() => ({ dir: root, name: "root" }), {
      readBackend: backend,
    });
    service.summarizeRepo = async (_cwd, relativePath) =>
      ({ relativePath }) as never;
    const [listing, status] = await Promise.all([
      service.discoverRepos("proj_test"),
      service.projectFileStatus("proj_test"),
    ]);
    assert.equal(discoveries, 1);
    assert.equal(batches, 1);
    assert.deepEqual(
      listing.repos.map((repo) => repo.relativePath),
      ["a"],
    );
    assert.deepEqual(
      status.files.map((item) => item.path),
      ["a/current.ts"],
    );
    assert.equal(status.errors?.[0]?.repo, "b");
    assert.equal(listing.errors?.[0]?.repo, "b");
    assert.doesNotMatch(JSON.stringify(status.errors), /raw private path/);
    service.invalidateProjectReads("proj_test");
    await service.projectFileStatus("proj_test");
    assert.equal(discoveries, 2);
    assert.equal(batches, 2);
    await service.closeRemoteCaches();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void it("uncertain invalidation during metadata summarization returns explicitly stale listing without aborting it", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "nerve-uncertain-git-read-")),
  );
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const service = new GitService(() => ({ dir: root, name: "root" }), {
    readBackend: statusBackend(async () => [file("file", " ", "M")]),
  });
  try {
    service.summarizeRepo = async () => {
      ready();
      await hold;
      return {} as never;
    };
    const listing = service.discoverRepos("proj_test");
    await started;
    service.invalidateProjectReads("proj_test", { uncertain: true });
    release();
    assert.equal((await listing).stale, true);
    assert.equal(
      (await service.projectFileStatus("proj_test")).stale,
      undefined,
      "new demand can revalidate without relabelling the old listing",
    );
  } finally {
    release();
    await service.closeRemoteCaches();
    await rm(root, { recursive: true, force: true });
  }
});

void it("rejects an older listing even when invalidation arrives during metadata summarization", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "nerve-stale-git-read-")),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const service = new GitService(() => ({ dir: root, name: "root" }), {
      readBackend: statusBackend(async () => [file("file", " ", "M")]),
    });
    service.summarizeRepo = async () => {
      ready();
      await gate;
      return {} as never;
    };
    const older = service.discoverRepos("proj_test");
    await started;
    await service.projectFileStatus("proj_test", true);
    const rejected = assert.rejects(
      older,
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    release();
    await rejected;
    await service.closeRemoteCaches();
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});
