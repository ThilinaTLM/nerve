import { readGitMetadataSnapshot } from "../../src/git/metadata-client.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { binding } from "../../src/binding/loader.js";
import {
  discoverGitRepositories,
  readGitProjectSnapshots,
} from "../../src/git/project-client.js";
import { readGitSnapshot } from "../../src/git/git-client.js";

const exec = promisify(execFile);
async function fixture(
  run: (
    root: string,
    git: (cwd: string, args: string[]) => Promise<void>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-project-addon-"));
  const saved = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")),
  );
  const isolation = join(root, ".fixture-config");
  await mkdir(join(isolation, "empty"), { recursive: true });
  const config = join(isolation, "config");
  const attributes = join(isolation, "attributes");
  await writeFile(attributes, "");
  await writeFile(
    config,
    `[core]\nattributesFile = ${JSON.stringify(attributes)}\n`,
  );
  for (const key of Object.keys(process.env))
    if (key.startsWith("GIT_")) delete process.env[key];
  Object.assign(process.env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_GLOBAL: config,
    GIT_TEMPLATE_DIR: join(isolation, "empty"),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
  const git = async (cwd: string, args: string[]) => {
    await exec(
      "git",
      [
        "-c",
        `core.hooksPath=${join(isolation, "empty")}`,
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
      { cwd, env: process.env },
    );
  };
  try {
    await run(root, git);
  } finally {
    for (const key of Object.keys(process.env))
      if (key.startsWith("GIT_")) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  }
}
async function repository(
  root: string,
  name: string,
  git: (cwd: string, args: string[]) => Promise<void>,
) {
  const path = join(root, name);
  await mkdir(path);
  await git(path, ["init", "--initial-branch=main"]);
  await git(path, ["config", "user.name", "Synthetic"]);
  await git(path, ["config", "user.email", "synthetic@example.invalid"]);
  await writeFile(join(path, ".gitignore"), "*.ignored\n");
  await writeFile(join(path, "tracked.txt"), "base\n");
  await git(path, ["add", "."]);
  await git(path, ["commit", "-qm", "initial"]);
  return path;
}

test("new addon returns canonical identities and complete status parity", async () =>
  fixture(async (root, git) => {
    const path = await repository(root, "repo", git);
    const config = join(root, ".fixture-config", "config");
    await writeFile(
      config,
      `${await readFile(config, "utf8")}[filter "unused"]\nclean = must-not-execute\n`,
    );
    await git(path, ["mv", "tracked.txt", "renamed.txt"]);
    await writeFile(join(path, "renamed.txt"), "modified\n");
    await writeFile(join(path, "new.txt"), "new\n");
    await writeFile(join(path, "x.ignored"), "ignored\n");
    await writeFile(join(path, ".git", "MERGE_HEAD"), "synthetic marker\n");
    const discovery = await discoverGitRepositories(root);
    // Rust's filesystem canonicalization retains Windows' namespaced spelling.
    // Use Node's path API, not prefix stripping (UNC/volume roots must survive).
    assert.equal(discovery.root, toNamespacedPath(await realpath(root)));
    assert.equal(discovery.repositories.length, 1);
    const descriptor = discovery.repositories[0]!;
    assert.equal(descriptor.workDir, toNamespacedPath(await realpath(path)));
    assert.equal(
      descriptor.gitDir,
      toNamespacedPath(await realpath(join(path, ".git"))),
    );
    assert.equal(descriptor.commonDir, descriptor.gitDir);
    const results = await readGitProjectSnapshots(discovery.repositories, {
      includeIgnored: true,
    });
    assert.equal(results[0]!.error, undefined);
    const snapshot = results[0]!.snapshot!;
    const full = await readGitSnapshot(path, { includeIgnored: true });
    assert.deepEqual(snapshot.files, full.files);
    assert.equal(snapshot.branch, full.headBranch);
    assert.equal(snapshot.headOid, full.headOid);
    assert.deepEqual(snapshot.inProgress, ["merge"]);
    assert.deepEqual(snapshot.inProgress, full.inProgress);
    assert.equal(snapshot.counts.staged, 1);
    assert.equal(snapshot.counts.unstaged, 1);
    assert.equal(snapshot.counts.untracked, 1);
    assert.equal(snapshot.counts.ignored, 1);
  }));

test("new addon classifies selected external filters with a stable isolation diagnostic", async () =>
  fixture(async (root, git) => {
    const path = await repository(root, "repo", git);
    await git(path, ["config", "filter.synthetic.clean", "must-not-execute"]);
    await git(path, ["config", "filter.synthetic.required", "true"]);
    await writeFile(
      join(path, ".gitattributes"),
      "tracked.txt filter=synthetic\n",
    );
    const discovery = await discoverGitRepositories(root);
    const result = (await readGitProjectSnapshots(discovery.repositories))[0]!;
    assert.equal(result.error?.category, "isolation_required");
    assert.equal(result.error?.retryable, false);
    assert.equal(result.snapshot, undefined);
  }));

test("new addon reports status overflow per repository without partial success", async () =>
  fixture(async (root, git) => {
    const path = await repository(root, "overflow", git);
    await repository(root, "healthy", git);
    for (let i = 0; i < 20_001; i++)
      writeFileSync(join(path, `untracked-${i}.txt`), "x\n");
    const discovery = await discoverGitRepositories(root);
    const results = await readGitProjectSnapshots(discovery.repositories);
    const overflow = results.find(
      (item) => item.repository.relativePath === "overflow",
    )!;
    assert.equal(overflow.error?.category, "limit_exceeded");
    assert.equal(overflow.error?.retryable, false);
    assert.equal(overflow.snapshot, undefined);
    assert.ok(
      results.find((item) => item.repository.relativePath === "healthy")
        ?.snapshot,
    );
  }));

test("actual native cancellation retains admission until task completion and revokes handles", async () =>
  fixture(async (root, git) => {
    const path = await repository(root, "repo", git);
    for (let i = 0; i < 10_000; i++)
      writeFileSync(join(path, `untracked-${i}.txt`), "x\n");
    const discovery = await discoverGitRepositories(root);
    const a = binding.createGitReadOperation().handle!;
    const b = binding.createGitReadOperation().handle!;
    let c: number | undefined;
    try {
      const pending = binding.readGitProjectSnapshots(
        discovery.repositories,
        false,
        a,
      );
      binding.cancelGitReadOperation(a);
      binding.closeGitReadOperation(a);
      assert.equal(
        binding.createGitReadOperation().error?.category,
        "limit_exceeded",
      );
      const result = await pending;
      assert.equal(result.error?.category, "cancelled");
      assert.equal(result.repositories, undefined);
      c = binding.createGitReadOperation().handle;
      assert.ok(c);
      assert.throws(() =>
        binding.readGitProjectSnapshots(discovery.repositories, false, a),
      );
    } finally {
      binding.closeGitReadOperation(a);
      binding.closeGitReadOperation(b);
      if (c !== undefined) binding.closeGitReadOperation(c);
    }
    assert.ok(
      (await readGitProjectSnapshots(discovery.repositories))[0]?.snapshot,
    );
  }));

test("new addon preserves submodule dirty and staged gitlink status", async () =>
  fixture(async (root, git) => {
    const source = await repository(root, "source", git);
    const parent = await repository(root, "parent", git);
    await git(parent, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      source,
      "child",
    ]);
    await git(parent, ["commit", "-am", "add child"]);
    const discovery = await discoverGitRepositories(parent);
    for (const stage of [false, true]) {
      const child = join(parent, "child");
      await writeFile(join(child, "tracked.txt"), "dirty\n");
      if (stage) {
        await git(child, ["add", "tracked.txt"]);
        await git(child, [
          "-c",
          "user.name=Synthetic",
          "-c",
          "user.email=synthetic@example.invalid",
          "commit",
          "-qm",
          "child update",
        ]);
        await git(parent, ["add", "child"]);
      }
      const result = await readGitProjectSnapshots(discovery.repositories);
      assert.equal(result[0]!.error, undefined);
      assert.deepEqual(
        result[0]!.snapshot!.files,
        (await readGitSnapshot(parent)).files,
      );
    }
  }));

test("actual addon metadata matches full fields without files and skips default history/status work", async () =>
  fixture(async (root, git) => {
    const path = await repository(root, "metadata", git);
    await git(path, ["remote", "add", "origin", join(root, "local-remote")]);
    await git(path, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await git(path, ["branch", "--set-upstream-to=origin/main", "main"]);
    await git(path, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);
    await writeFile(join(path, "tracked.txt"), "stash change\n");
    await git(path, ["stash", "push", "-qm", "synthetic stash"]);
    const full = await readGitSnapshot(path);
    const { files, ...expected } = full;
    assert.deepEqual(files, []);
    const metadata = await readGitMetadataSnapshot(path, {
      recentCommitLimit: 10,
      stashLimit: 1000,
    });
    assert.deepEqual(metadata, expected);
    assert.equal("files" in metadata, false);
    const defaults = await readGitMetadataSnapshot(path);
    assert.deepEqual(defaults.recentCommits, []);
    assert.deepEqual(defaults.stashes, []);
    await assert.rejects(readGitMetadataSnapshot(path, { refLimit: 0 }), {
      category: "limit_exceeded",
      retryable: false,
    });
    await assert.rejects(
      readGitMetadataSnapshot(path, { signal: AbortSignal.abort() }),
      { category: "cancelled" },
    );
    // Prove the metadata route does not touch the index/status kernel.
    await writeFile(join(path, ".git", "index"), "not an index");
    assert.equal((await readGitMetadataSnapshot(path)).headOid, full.headOid);
  }));
