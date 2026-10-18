import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// Synthetic only. Run each case in its own process: tsx ... <1|5|20> <repeated|shared|native>.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { promisify } from "node:util";
import {
  readGitRepositoryInfo,
  readGitSnapshot,
} from "../../src/git/git-client.js";

const exec = promisify(execFile);
const count = Number(process.argv[2] ?? 1);
const mode = process.argv[3] ?? "repeated";
if (
  ![1, 5, 20].includes(count) ||
  ![
    "repeated",
    "shared",
    "native",
    "native-shared",
    "native-individual",
  ].includes(mode)
)
  throw new Error("Invalid benchmark case");
const root = await mkdtemp(join(tmpdir(), "nerve-git-bench-"));
const isolation = join(root, ".fixture-config");
await mkdir(join(isolation, "empty"), { recursive: true });
const emptyConfig = join(isolation, "config");
const attributes = join(isolation, "attributes");
await writeFile(attributes, "");
await writeFile(
  emptyConfig,
  `[core]\nattributesFile = ${JSON.stringify(attributes)}\n`,
);
// This benchmark is an isolated process. Sanitize native reads as well as fixture CLI calls.
for (const key of Object.keys(process.env))
  if (key.startsWith("GIT_")) delete process.env[key];
Object.assign(process.env, {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: emptyConfig,
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_TEMPLATE_DIR: join(isolation, "empty"),
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
});
const git = async (cwd: string, args: string[]) =>
  exec(
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
async function discover(dir = root, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      ["node_modules", "dist", "build"].includes(entry.name)
    )
      continue;
    const child = join(dir, entry.name);
    if (existsSync(join(child, ".git"))) found.push(child);
    else found.push(...(await discover(child, depth + 1)));
  }
  return found;
}
async function discovery(): Promise<string[]> {
  try {
    const info = await readGitRepositoryInfo(root);
    if (!info.bare) return [root];
  } catch {
    /* not a repo */
  }
  return discover();
}
async function snapshots(paths: string[], ignored: boolean) {
  const results: Awaited<ReturnType<typeof readGitSnapshot>>[] = new Array(
    paths.length,
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (next < paths.length) {
        const i = next++;
        results[i] = await readGitSnapshot(paths[i]!, {
          includeIgnored: ignored,
        });
      }
    }),
  );
  return results;
}
try {
  for (let r = 0; r < count; r++) {
    const repo = join(root, `repo-${r}`);
    await mkdir(repo);
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Synthetic"]);
    await git(repo, ["config", "user.email", "synthetic@example.invalid"]);
    await writeFile(join(repo, ".gitignore"), "*.ignored\n");
    for (let i = 0; i < 200; i++)
      await writeFile(join(repo, `file-${i}.txt`), `base ${i}\n`);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "synthetic initial"]);
    const { stdout } = await git(repo, ["rev-parse", "HEAD"]);
    // Branch metadata makes the full-snapshot overhead visible, without network or user repositories.
    for (let i = 0; i < 100; i++)
      await writeFile(
        join(repo, ".git", "refs", "heads", `branch-${i}`),
        stdout,
      );
    for (let i = 0; i < 10; i++) {
      await writeFile(join(repo, `file-${i}.txt`), "modified\n");
      await writeFile(join(repo, `${i}.ignored`), "ignored\n");
    }
    await writeFile(join(repo, "new.txt"), "new\n");
    await git(repo, ["add", "file-0.txt"]);
  }
  const cached = await discovery();
  const project = mode.startsWith("native")
    ? await import("../../src/git/project-client.js")
    : undefined;
  const nativeDiscovery = project
    ? await project.discoverGitRepositories(root)
    : undefined;
  const assemble = (
    items: {
      repo: string;
      branch?: string;
      files: Awaited<ReturnType<typeof readGitSnapshot>>["files"];
    }[],
  ) => ({
    repos: items.map((item) => ({
      repo: item.repo,
      branch: item.branch ?? null,
    })),
    files: items
      .flatMap((item) =>
        item.files.map((file) => ({
          ...file,
          repo: item.repo,
          path: `${item.repo}/${file.path}`,
        })),
      )
      .sort((a, b) => a.path.localeCompare(b.path)),
  });
  const refresh = async () => {
    if (project && nativeDiscovery) {
      const discovery =
        mode === "native"
          ? await project.discoverGitRepositories(root)
          : nativeDiscovery;
      const result =
        mode === "native-individual"
          ? (
              await Promise.all(
                Array.from(
                  { length: Math.min(2, discovery.repositories.length) },
                  async (_, worker) => {
                    const items = [];
                    for (
                      let i = worker;
                      i < discovery.repositories.length;
                      i += 2
                    )
                      items.push(
                        ...(await project.readGitProjectSnapshots(
                          [discovery.repositories[i]!],
                          { includeIgnored: true },
                        )),
                      );
                    return items;
                  },
                ),
              )
            ).flat()
          : await project.readGitProjectSnapshots(discovery.repositories, {
              includeIgnored: true,
            });
      return assemble(
        result
          .sort((a, b) =>
            a.repository.relativePath.localeCompare(b.repository.relativePath),
          )
          .map((item) => {
            if (item.error) throw new Error(item.error.message);
            return {
              repo: basename(item.repository.workDir),
              branch: item.snapshot!.branch,
              files: item.snapshot!.files,
            };
          }),
      );
    }
    const listed = mode === "shared" ? cached : await discovery();
    await snapshots(listed, false);
    const paths = mode === "shared" ? cached : await discovery();
    const files = await snapshots(paths, true);
    return assemble(
      files.map((snapshot, i) => ({
        repo: basename(paths[i]!),
        branch: snapshot.headBranch,
        files: snapshot.files,
      })),
    );
  };
  const firstStart = performance.now();
  await refresh();
  const firstRefreshMs = performance.now() - firstStart;
  const samples: number[] = [];
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 2);
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  let resultBytes = 0;
  let resultDigest = "";
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    const result = await refresh();
    samples.push(performance.now() - start);
    resultBytes = Buffer.byteLength(JSON.stringify(result));
    assert.equal(result.repos.length, count);
    assert.equal(result.files.length, count * 21);
    resultDigest = createHash("sha256")
      .update(
        JSON.stringify(
          result.files.map((file) => [
            file.repo,
            file.path,
            file.index,
            file.worktree,
            file.untracked,
            file.ignored,
            file.renamedFrom ?? null,
          ]),
        ),
      )
      .digest("hex");
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  delay.disable();
  clearInterval(sampler);
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      count,
      mode,
      fixture:
        "200 tracked files, 100 extra refs, 10 modified, 10 ignored, 1 untracked/repo",
      rounds: 9,
      firstRefreshMs,
      resultDigest,
      p50Ms: samples[4],
      p95Ms: samples[8],
      eventLoopP95Ms: delay.percentile(95) / 1e6,
      eventLoopMaxMs: delay.max / 1e6,
      peakRssMiB: peakRss / 1048576,
      retainedRssMiB: process.memoryUsage().rss / 1048576,
      resultBytes,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
