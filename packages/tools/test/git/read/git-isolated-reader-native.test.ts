import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  discoverGitRepositories,
  readGitSnapshot,
  readGitProjectSnapshots,
  spawnManagedProcess,
} from "@nervekit/native";
import { createGitIsolatedReader } from "../../../src/git/read/git-isolated-reader.js";
import { lightGitIsolatedSnapshot } from "../../../src/git/read/git-isolated-reader-protocol.js";

const exec = promisify(execFile);
async function fixture(
  run: (
    root: string,
    repo: string,
    git: (args: string[]) => Promise<void>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-isolated-unit-"));
  const repo = join(root, "repo"),
    empty = join(root, "empty"),
    config = join(root, "config"),
    attributes = join(root, "attributes");
  await mkdir(repo);
  await mkdir(empty);
  await writeFile(attributes, "");
  await writeFile(
    config,
    `[core]\nattributesFile = ${JSON.stringify(attributes)}\n`,
  );
  const saved = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")),
  );
  for (const key of Object.keys(process.env))
    if (key.startsWith("GIT_")) delete process.env[key];
  Object.assign(process.env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_GLOBAL: config,
    GIT_TEMPLATE_DIR: empty,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
  const git = async (args: string[]) => {
    await exec(
      "git",
      [
        "-c",
        `core.hooksPath=${empty}`,
        "-c",
        `core.attributesFile=${attributes}`,
        "-c",
        "commit.gpgSign=false",
        "-c",
        "tag.gpgSign=false",
        "-c",
        "credential.helper=",
        ...args,
      ],
      { cwd: repo, env: process.env },
    );
  };
  try {
    await git(["init", "--initial-branch=main"]);
    await git(["config", "user.name", "Synthetic"]);
    await git(["config", "user.email", "synthetic@example.invalid"]);
    await writeFile(join(repo, "tracked.txt"), "base\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "initial"]);
    await run(root, repo, git);
  } finally {
    for (const key of Object.keys(process.env))
      if (key.startsWith("GIT_")) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  }
}
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

test("actual managed helper loads source bootstrap and preserves native snapshot/state", async () =>
  fixture(async (_root, repo) => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await writeFile(join(repo, ".git", "MERGE_HEAD"), "synthetic marker\n");
    const discovery = await discoverGitRepositories(repo);
    const reader = createGitIsolatedReader();
    try {
      const actual = await reader.read(discovery.repositories[0]!, {
        timeoutMs: 10_000,
      });
      assert.deepEqual(
        actual,
        lightGitIsolatedSnapshot(await readGitSnapshot(repo)),
      );
      assert.deepEqual(actual.inProgress, ["merge"]);
    } finally {
      await reader.close();
    }
  }));

test(
  "actual helper runs selected existing native clean filter (POSIX synthetic fixture)",
  { skip: process.platform === "win32" },
  async () =>
    fixture(async (root, repo, git) => {
      const script = join(root, "clean.cjs");
      await writeFile(script, "process.stdin.pipe(process.stdout);\n");
      await git([
        "config",
        "filter.synthetic.clean",
        `${quote(process.execPath)} ${quote(script)}`,
      ]);
      await git(["config", "filter.synthetic.required", "true"]);
      await writeFile(
        join(repo, ".gitattributes"),
        "tracked.txt filter=synthetic\n",
      );
      await writeFile(join(repo, "tracked.txt"), "dirt\n");
      await utimes(
        join(repo, "tracked.txt"),
        new Date(),
        new Date(Date.now() + 2_000),
      );
      const discovery = await discoverGitRepositories(repo);
      const primary = await readGitProjectSnapshots(discovery.repositories);
      assert.equal(primary[0]?.error?.category, "isolation_required");
      assert.equal(primary[0]?.error?.retryable, false);
      const reader = createGitIsolatedReader();
      try {
        const snapshot = await reader.read(discovery.repositories[0]!, {
          timeoutMs: 10_000,
        });
        assert.deepEqual(
          snapshot,
          lightGitIsolatedSnapshot(await readGitSnapshot(repo)),
        );
        assert.ok(
          snapshot.files.some(
            (file) => file.path === "tracked.txt" && file.worktree === "M",
          ),
        );
      } finally {
        await reader.close();
      }
    }),
);

test(
  "stale cached identity is rejected before a configured filter marker executes",
  { skip: process.platform === "win32" },
  async () =>
    fixture(async (root, repo, git) => {
      const marker = join(root, "must-not-run"),
        script = join(root, "marker-clean.cjs");
      await writeFile(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);\n`,
      );
      await git([
        "config",
        "filter.synthetic.clean",
        `${quote(process.execPath)} ${quote(script)}`,
      ]);
      await git(["config", "filter.synthetic.required", "true"]);
      await writeFile(
        join(repo, ".gitattributes"),
        "tracked.txt filter=synthetic\n",
      );
      await writeFile(join(repo, "tracked.txt"), "dirt\n");
      await utimes(
        join(repo, "tracked.txt"),
        new Date(),
        new Date(Date.now() + 2_000),
      );
      const cached = (await discoverGitRepositories(repo)).repositories[0]!;
      await rename(join(repo, ".git"), join(root, "moved.git"));
      await writeFile(join(repo, ".git"), "gitdir: ../moved.git\n");
      await git(["config", "core.worktree", repo]);
      const fresh = await discoverGitRepositories(repo);
      assert.equal(fresh.projectIsRepo, true);
      assert.notEqual(fresh.repositories[0]?.gitDir, cached.gitDir);
      const reader = createGitIsolatedReader();
      try {
        await assert.rejects(reader.read(cached, { timeoutMs: 10_000 }), {
          category: "invalid_input",
        });
        await assert.rejects(readFile(marker), { code: "ENOENT" });
      } finally {
        await reader.close();
      }
    }),
);

test(
  "actual abort kills TERM-ignoring filter and joins helper before rejecting (POSIX)",
  { skip: process.platform === "win32" },
  async () =>
    fixture(async (root, repo, git) => {
      const script = join(root, "blocked-clean.cjs"),
        marker = join(root, "filter.pid");
      await writeFile(
        script,
        `const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000);\n`,
      );
      await git([
        "config",
        "filter.synthetic.clean",
        `${quote(process.execPath)} ${quote(script)}`,
      ]);
      await git(["config", "filter.synthetic.required", "true"]);
      await writeFile(
        join(repo, ".gitattributes"),
        "tracked.txt filter=synthetic\n",
      );
      await writeFile(join(repo, "tracked.txt"), "dirt\n");
      await utimes(
        join(repo, "tracked.txt"),
        new Date(),
        new Date(Date.now() + 2_000),
      );
      const discovery = await discoverGitRepositories(repo);
      const controller = new AbortController();
      let helperClosed = false;
      const reader = createGitIsolatedReader({
        spawn(...args) {
          const child = spawnManagedProcess(...args);
          void child.closed.then(() => {
            helperClosed = true;
          });
          return child;
        },
      });
      const pending = reader.read(discovery.repositories[0]!, {
        signal: controller.signal,
        timeoutMs: 10_000,
      });
      const checked = assert.rejects(pending, { category: "cancelled" });
      void checked.catch(() => {});
      try {
        const deadline = Date.now() + 5_000;
        let pid: number | undefined;
        while (Date.now() < deadline) {
          try {
            pid = Number(await readFile(marker, "utf8"));
            break;
          } catch {
            await delay(10);
          }
        }
        assert.ok(pid && Number.isSafeInteger(pid));
        controller.abort();
        await checked;
        assert.equal(helperClosed, true);
        const closedDeadline = Date.now() + 2_000;
        while ((await alive(pid)) && Date.now() < closedDeadline)
          await delay(10);
        assert.equal(await alive(pid), false);
      } finally {
        controller.abort();
        await reader.close();
        await checked;
      }
    }),
);
