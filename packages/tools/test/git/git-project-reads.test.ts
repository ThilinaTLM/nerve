import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { GitService } from "../../src/git/git-service.js";

const exec = promisify(execFile);

void test("actual project APIs share discovery/light batch across listing and ignored-file status", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-project-unit-"));
  const project = join(root, "project");
  const empty = join(root, "empty");
  const config = join(root, "config");
  await mkdir(project);
  await mkdir(empty);
  await writeFile(config, "");
  // Test-worker-only isolation. Production keeps the real user's environment.
  const overrides: Record<string, string | undefined> = {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG: undefined,
    GIT_CONFIG_PARAMETERS: undefined,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_COMMON_DIR: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_OBJECT_DIRECTORY: undefined,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
    GIT_TEMPLATE_DIR: empty,
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const operations: string[] = [];
  // Observe only read operation names, never environment values or command output.
  const observed = new GitService(
    () => ({ dir: project, name: "Synthetic project" }),
    { onReadCompleted: (event) => operations.push(event.operation) },
  );
  try {
    for (const name of ["a", "b"]) {
      const dir = join(project, name);
      await mkdir(dir);
      await exec(
        "git",
        [
          "-c",
          `core.hooksPath=${empty}`,
          "-c",
          "commit.gpgsign=false",
          "init",
          "--initial-branch=main",
          `--template=${empty}`,
        ],
        { cwd: dir, env: process.env },
      );
      await writeFile(join(dir, ".gitignore"), "ignored/\n");
      await writeFile(join(dir, "tracked.txt"), "synthetic tracked\n");
      await exec(
        "git",
        ["-c", `core.hooksPath=${empty}`, "add", ".gitignore", "tracked.txt"],
        { cwd: dir, env: process.env },
      );
      await mkdir(join(dir, "ignored"));
      await writeFile(join(dir, "ignored", "cache.txt"), "synthetic ignored\n");
      await writeFile(join(dir, "work.txt"), "synthetic untracked\n");
    }
    const [listing, status] = await Promise.all([
      observed.discoverRepos("proj_synthetic"),
      observed.projectFileStatus("proj_synthetic"),
    ]);
    assert.deepEqual(listing.errors, []);
    assert.deepEqual(status.errors, []);
    assert.deepEqual(
      listing.repos.map((repo) => repo.relativePath),
      ["a", "b"],
    );
    assert.equal(
      operations.filter((name) => name === "project-discovery").length,
      1,
    );
    assert.equal(
      operations.filter((name) => name === "project-snapshots").length,
      1,
    );
    assert.ok(
      status.files.some(
        (file) =>
          file.repo === "a" &&
          file.path.startsWith("a/ignored") &&
          file.index === "!",
      ),
    );
    assert.ok(
      status.files.some((file) => file.path === "b/work.txt" && file.untracked),
    );
    await observed.projectFileStatus("proj_synthetic", true);
    assert.equal(
      operations.filter((name) => name === "project-discovery").length,
      2,
    );
  } finally {
    await observed.closeRemoteCaches();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
