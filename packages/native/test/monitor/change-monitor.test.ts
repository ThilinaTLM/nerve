import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ChangeMonitor, type ChangeNotice } from "../../src/index.js";

test("manual and filesystem triggers share a bounded monitor scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-monitor-"));
  const child = join(root, "child");
  await mkdir(child);
  const notices: ChangeNotice[] = [];
  const monitor = new ChangeMonitor((notice) => notices.push(notice), {
    maxRegistrations: 4,
    maxDirectoriesPerScope: 2,
  });
  try {
    const state = await monitor.syncDirectories({
      id: "project:test",
      paths: [root, child],
      pollIntervalMs: 60_000,
    });
    assert.equal(state.watchedPaths, 2);
    assert.equal(state.degraded, false);
    const generation = await monitor.requestRefresh("project:test");
    assert.equal(generation, 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(notices[0]?.scopeId, "project:test");
    assert.equal(notices[0]?.generation, 1);
    assert.deepEqual(notices[0]?.causes, ["manual"]);
    assert.equal(monitor.diagnostics().registrations, 2);
  } finally {
    await monitor.close();
    await rm(root, { recursive: true, force: true });
  }
});

const exec = promisify(execFile);

test(
  "large ignored-style trees do not increase Linux registrations",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-monitor-budget-"));
    await Promise.all(
      Array.from({ length: 250 }, async (_, index) => {
        await mkdir(join(root, "node_modules", `package-${index}`), {
          recursive: true,
        });
        await mkdir(join(root, ".git", "objects", index.toString(16)), {
          recursive: true,
        });
      }),
    );
    const baseline = await inotifyRegistrations();
    const monitor = new ChangeMonitor(() => undefined);
    try {
      const state = await monitor.syncDirectories({
        id: "project:large",
        paths: [root],
        pollIntervalMs: 60_000,
      });
      assert.equal(state.watchedPaths, 1);
      assert.ok((await inotifyRegistrations()) - baseline <= 1);
    } finally {
      await monitor.close();
      await rm(root, { recursive: true, force: true });
    }
    assert.ok((await inotifyRegistrations()) <= baseline);
  },
);

test(
  "Git scope keeps a constant watch plan regardless of object count",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-monitor-git-"));
    await exec("git", ["init", "--initial-branch=main"], { cwd: root });
    await exec("git", ["config", "user.name", "Nerve Test"], { cwd: root });
    await exec("git", ["config", "user.email", "nerve@example.com"], {
      cwd: root,
    });
    await writeFile(join(root, "tracked.txt"), "initial\n");
    await exec("git", ["add", "tracked.txt"], { cwd: root });
    await exec("git", ["commit", "-m", "initial"], { cwd: root });
    await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        mkdir(join(root, ".git", "objects", `synthetic-${index}`)),
      ),
    );
    const baseline = await inotifyRegistrations();
    const monitor = new ChangeMonitor(() => undefined);
    try {
      const state = await monitor.syncGit({
        id: "git:test",
        repository: root,
        pollIntervalMs: 60_000,
      });
      assert.ok(state.watchedPaths <= 12);
      assert.ok((await inotifyRegistrations()) - baseline <= 12);
    } finally {
      await monitor.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function inotifyRegistrations(): Promise<number> {
  let total = 0;
  for (const entry of await readdir("/proc/self/fdinfo")) {
    const text = await readFile(`/proc/self/fdinfo/${entry}`, "utf8").catch(
      () => "",
    );
    total += text
      .split("\n")
      .filter((line) => line.startsWith("inotify")).length;
  }
  return total;
}

test(
  "read-only HEAD and Git diff access stays quiet while genuine writes still invalidate public monitor scopes",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-monitor-read-only-"));
    const repository = join(root, "repository");
    const hooks = join(root, "hooks");
    const template = join(root, "template");
    const config = join(root, "empty-config");
    await Promise.all([
      mkdir(repository),
      mkdir(hooks),
      mkdir(template),
      writeFile(config, ""),
    ]);
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: config,
      GIT_TEMPLATE_DIR: template,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Nerve Test",
      GIT_AUTHOR_EMAIL: "nerve@example.com",
      GIT_COMMITTER_NAME: "Nerve Test",
      GIT_COMMITTER_EMAIL: "nerve@example.com",
    });
    const git = (...args: string[]) =>
      exec(
        "git",
        [
          "-c",
          `core.hooksPath=${hooks}`,
          "-c",
          "commit.gpgSign=false",
          ...args,
        ],
        { cwd: repository, env },
      );
    const notices: ChangeNotice[] = [];
    const monitor = new ChangeMonitor((notice) => notices.push(notice));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
    try {
      await git("init", "--initial-branch=main");
      await writeFile(join(repository, "tracked.txt"), "initial\n");
      await git("add", "tracked.txt");
      await git("commit", "-m", "synthetic fixture");
      // Warm any legitimate index/stat refresh before watching. No optional-lock
      // flags suppress writes during the observed commands below.
      await git("diff", "--shortstat");
      await git("diff", "--staged", "--shortstat");
      await monitor.syncDirectories({
        id: "project:read-only",
        paths: [repository, join(repository, ".git")],
        pollIntervalMs: 60_000,
      });
      await monitor.syncGit({
        id: "git:read-only",
        repository,
        pollIntervalMs: 60_000,
      });
      await settle();
      notices.length = 0;
      const head = await readFile(join(repository, ".git", "HEAD"));
      await settle();
      assert.deepEqual(
        notices,
        [],
        "reading HEAD must not produce filesystem invalidation",
      );
      await git("diff", "--shortstat");
      await settle();
      assert.deepEqual(notices, [], "unstaged diff reads must not invalidate");
      await git("diff", "--staged", "--shortstat");
      await settle();
      assert.deepEqual(notices, [], "staged diff reads must not invalidate");
      // Even a same-content write is a genuine write and must remain visible.
      await writeFile(join(repository, ".git", "HEAD"), head);
      const deadline = Date.now() + 4_000;
      const changed = (scope: string) =>
        notices.some(
          (notice) =>
            notice.scopeId === scope && notice.causes.includes("filesystem"),
        );
      while (
        (!changed("project:read-only") || !changed("git:read-only")) &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.ok(
        changed("project:read-only"),
        "directory scope must retain actual writes",
      );
      assert.ok(
        changed("git:read-only"),
        "Git scope must retain actual writes",
      );
    } finally {
      await monitor.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
