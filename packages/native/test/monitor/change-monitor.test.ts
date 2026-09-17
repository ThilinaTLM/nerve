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
