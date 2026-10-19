import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  rename,
  symlink,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { initializeManagedProcessHost } from "@nervekit/native";
import { GitService } from "../../src/git/git-service.js";
import { NativeGitReadBackend } from "../../src/git/read/native-backend.js";
import { createGitIsolatedReader } from "../../src/git/read/git-isolated-reader.js";
import { inGitLane } from "../../src/git/git-operation-context.js";
const exec = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function markers(path: string): Promise<number[]> {
  try {
    return (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      // Pipe closure can precede the end of kernel exit cleanup. A killed
      // descendant may still be R with PF_EXITING set, or X (dead), before
      // becoming Z (zombie) or disappearing. None can run user code again.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const [state] = fields;
      const flags = Number(fields[6]); // /proc stat field 9; PF_EXITING = 0x4.
      if (state === "Z" || state === "X" || (flags & 0x4) !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}
async function waitForFilter(marker: string, previous = 0): Promise<number> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const pids = await markers(marker);
    if (pids.length > previous) return pids.at(-1)!;
    await delay();
  }
  assert.fail("public backend never reached selected filter helper");
}
async function fixture(
  run: (f: {
    service: GitService;
    backend: NativeGitReadBackend;
    root: string;
    normal: string;
    filtered: string;
    marker: string;
    mode: string;
    helperCalls: () => number;
  }) => Promise<void>,
) {
  // Explicit test-host initialization only; production does not gain implicit init.
  initializeManagedProcessHost({ allowUncontained: true });
  const root = await mkdtemp(join(tmpdir(), "nerve-public-git-filter-"));
  const empty = join(root, "empty"),
    config = join(root, "config"),
    attributes = join(root, "attributes");
  const marker = join(root, "filter-pids"),
    mode = join(root, "filter-mode"),
    script = join(root, "filter.cjs");
  await mkdir(empty);
  await writeFile(attributes, "");
  await writeFile(
    config,
    `[core]\nattributesFile = ${JSON.stringify(attributes)}\n`,
  );
  await writeFile(mode, "copy");
  await writeFile(
    script,
    `const fs = require('node:fs'); const block = fs.readFileSync(${JSON.stringify(mode)},'utf8') === 'block'; if(block) { process.on('SIGTERM',()=>{}); process.stdin.resume(); setInterval(()=>{},1000); } fs.appendFileSync(${JSON.stringify(marker)}, process.pid+'\\n'); if(!block) process.stdin.pipe(process.stdout);\n`,
  );
  const environment = Object.fromEntries(
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
  const normal = join(root, "normal"),
    filtered = join(root, "filtered");
  const git = async (cwd: string, args: string[]) => {
    await exec(
      "git",
      [
        "-c",
        `core.hooksPath=${empty}`,
        "-c",
        "commit.gpgSign=false",
        "-c",
        "tag.gpgSign=false",
        "-c",
        "credential.helper=",
        ...args,
      ],
      { cwd, env: process.env },
    );
  };
  const isolated = createGitIsolatedReader();
  let helperCalls = 0;
  const backend = new NativeGitReadBackend(Date.now, {
    isolatedReader: {
      read: (repository, options) => {
        helperCalls++;
        return isolated.read(repository, options);
      },
      close: () => isolated.close(),
    },
  });
  const service = new GitService(
    () => ({ dir: root, name: "Synthetic project" }),
    { readBackend: backend },
  );
  try {
    for (const repo of [normal, filtered]) {
      await mkdir(repo);
      await git(repo, ["init", "--initial-branch=main"]);
      await git(repo, ["config", "user.name", "Synthetic"]);
      await git(repo, ["config", "user.email", "synthetic@example.invalid"]);
      await writeFile(join(repo, "tracked.txt"), "base\n");
      await git(repo, ["add", "tracked.txt"]);
      await git(repo, ["commit", "-qm", "initial"]);
      await git(repo, [
        "remote",
        "add",
        "origin",
        "https://github.com/example/repo.git",
      ]);
      // Same byte length forces actual clean-filter content comparison rather
      // than an early size-mismatch dirty result.
      await writeFile(
        join(repo, "tracked.txt"),
        repo === filtered ? "dirt\n" : "changed synthetic content\n",
      );
      await utimes(
        join(repo, "tracked.txt"),
        new Date(),
        new Date(Date.now() + 2000),
      );
    }
    await git(filtered, [
      "config",
      "filter.synthetic.clean",
      `${quote(process.execPath)} ${quote(script)}`,
    ]);
    await git(filtered, ["config", "filter.synthetic.required", "true"]);
    await writeFile(
      join(filtered, ".gitattributes"),
      "tracked.txt filter=synthetic\n",
    );
    await run({
      service,
      backend,
      root,
      normal,
      filtered,
      marker,
      mode,
      helperCalls: () => helperCalls,
    });
  } finally {
    await service.closeRemoteCaches();
    for (const key of Object.keys(process.env))
      if (key.startsWith("GIT_")) delete process.env[key];
    Object.assign(process.env, environment);
    await rm(root, { recursive: true, force: true });
  }
}

void test(
  "actual public backend keeps metadata filter-free and adopts helper status for overview and checkout preflight",
  { skip: process.platform === "win32", timeout: 15_000 },
  async () =>
    fixture(async (f) => {
      const metadata = await f.backend.metadata(f.filtered);
      assert.equal(metadata.branch.head, "main");
      assert.equal("files" in metadata, false);
      assert.equal(
        (await f.service.stableRepoMetadata(f.filtered)).remoteState
          .hasGithubRemote,
        true,
      );
      assert.equal(
        (await f.service.repoRemoteState(f.filtered)).hasRemote,
        true,
      );
      assert.ok(
        (await f.service.listBranches("proj_synthetic", "filtered")).branches
          .length > 0,
      );
      assert.equal((await f.service.recentCommits(f.filtered)).length, 1);
      assert.deepEqual(
        await markers(f.marker),
        [],
        "metadata, refs, remotes and history must never execute a filter",
      );
      assert.equal(f.helperCalls(), 0);
      const normal = await f.service.overview("proj_synthetic", "normal");
      assert.equal(normal.repo.dirty, true);
      assert.equal(f.helperCalls(), 0);
      const filtered = await f.service.overview("proj_synthetic", "filtered");
      assert.equal(
        f.helperCalls(),
        1,
        "real public backend selected the actual managed helper",
      );
      assert.equal(filtered.repo.dirty, true);
      assert.ok(
        filtered.files.some(
          (file) => file.path === "tracked.txt" && file.worktree === "M",
        ),
      );
      assert.equal(filtered.stale, undefined);
      assert.ok((await markers(f.marker)).length > 0);
      await assert.rejects(
        f.service.checkoutPr("proj_synthetic", "filtered", 42),
        /uncommitted changes/,
      );
      assert.equal(
        f.helperCalls(),
        2,
        "real checkout preflight reenters and uses isolated dirty-status guard before any GitHub request",
      );
    }),
);

void test(
  "actual metadata/status composition accepts a symlinked Git directory with canonical identity",
  { skip: process.platform === "win32", timeout: 10_000 },
  async () =>
    fixture(async (f) => {
      const actual = join(f.root, "normal-git-dir");
      await rename(join(f.normal, ".git"), actual);
      await symlink(actual, join(f.normal, ".git"), "dir");
      const overview = await f.service.overview("proj_synthetic", "normal");
      assert.equal(overview.repo.currentBranch, "main");
      assert.equal(overview.repo.dirty, true);
    }),
);

void test(
  "actual public backend cancellation and shutdown await filter/helper closure while unrelated repository progresses",
  { skip: process.platform === "win32", timeout: 15_000 },
  async () =>
    fixture(async (f) => {
      await writeFile(f.mode, "block");
      const controller = new AbortController();
      const reading = inGitLane(
        f.filtered,
        false,
        () => f.backend.snapshot(f.filtered),
        { signal: controller.signal },
      );
      const rejected = assert.rejects(
        reading,
        { category: "cancelled" },
        "caller cancellation must reject the real composed read",
      );
      const pid = await waitForFilter(f.marker);
      const normal = await f.service.overview("proj_synthetic", "normal");
      assert.equal(normal.repo.dirty, true);
      let sameRepoRan = false;
      const queued = inGitLane(f.filtered, false, async () => {
        assert.equal(await alive(pid), false);
        sameRepoRan = true;
      });
      controller.abort();
      assert.equal(sameRepoRan, false);
      await Promise.all([rejected, queued]);
      assert.equal(sameRepoRan, true);
      assert.equal(await alive(pid), false);
      const beforeOverview = (await markers(f.marker)).length;
      const overview = f.service.overview("proj_synthetic", "filtered");
      const hardCancelled = assert.rejects(overview, { category: "cancelled" });
      const overviewPid = await waitForFilter(f.marker, beforeOverview);
      for (let poll = 0; poll < 3; poll++)
        f.service.invalidateProjectReads("proj_synthetic", { uncertain: true });
      assert.equal(
        f.service.overview("proj_synthetic", "filtered"),
        overview,
        "uncertain demand joins the kept whole overview",
      );
      assert.equal(await alive(overviewPid), true);
      f.service.invalidateProjectReads("proj_synthetic");
      await hardCancelled;
      assert.equal(
        await alive(overviewPid),
        false,
        "actual change aborts and joins the whole overview/helper before settling",
      );
      const previous = (await markers(f.marker)).length;
      const second = f.backend.snapshot(f.filtered);
      const interrupted = assert.rejects(
        second,
        { category: "cancelled" },
        "shutdown must reject the second real composed read",
      );
      const secondPid = await waitForFilter(f.marker, previous);
      const closing = f.service.closeRemoteCaches();
      await Promise.all([interrupted, closing]);
      assert.equal(await alive(secondPid), false);
      await assert.rejects(
        async () => f.backend.snapshot(f.filtered),
        /closed/,
      );
    }),
);
