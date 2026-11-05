#!/usr/bin/env node
// Cut a release from an up-to-date `main`: bump every workspace version, stamp
// pending Discover news, mark draft migration steps released, make one signed
// release commit, tag it, and push the commit and tag to origin/main atomically.
//
//   pnpm release:tag X.Y.Z [--dry-run] [--yes]
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { CliError, defineCli } from "../cli/main.ts";
import { parseCli } from "../cli/args.ts";
import { repoRoot } from "../workspace/repo.ts";
import { stampPendingDiscoverRelease } from "./discover-release.ts";
import { releaseDraftMigrations } from "./release-migrations.ts";
import {
  assertReleaseVersion,
  setWorkspaceVersion,
} from "./release-version.ts";
import { assertWorkspaceVersionsMatch } from "./workspace-packages.ts";

const RELEASE_BRANCH = "main";
const VERSION_FILES = [
  "package.json",
  "packages/*/package.json",
  "packages/workbench-app/src/lib/app/discover/content/news.ts",
  "packages/native/native/Cargo.toml",
  "Cargo.lock",
];

function git(args: string[], { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure)
    throw new CliError(
      `git ${args.join(" ")} failed:\n${result.stderr.trim() || result.stdout.trim()}`,
    );
  return { status: result.status, stdout: result.stdout.trim() };
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new CliError(`${command} ${args.join(" ")} failed`);
}

function assertReadyToRelease(tag: string) {
  if (git(["status", "--porcelain", "--untracked-files=normal"]).stdout)
    throw new CliError("The working tree must be clean before a release.");
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFailure: true,
  }).stdout;
  if (branch !== RELEASE_BRANCH)
    throw new CliError(
      `Releases are cut from ${RELEASE_BRANCH}; currently on ${branch || "detached HEAD"}.`,
    );
  git(["fetch", "--quiet", "origin", RELEASE_BRANCH, "--tags"]);
  const head = git(["rev-parse", "HEAD"]).stdout;
  const remote = git(["rev-parse", `origin/${RELEASE_BRANCH}`]).stdout;
  if (head !== remote)
    throw new CliError(
      `Local ${RELEASE_BRANCH} (${head.slice(0, 9)}) must equal origin/${RELEASE_BRANCH} (${remote.slice(0, 9)}); pull or push first.`,
    );
  if (
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
      allowFailure: true,
    }).status === 0
  )
    throw new CliError(`Tag ${tag} already exists locally.`);
  const remoteTag = git(
    ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
    { allowFailure: true },
  );
  if (remoteTag.status === 0)
    throw new CliError(`Tag ${tag} already exists on origin.`);
  if (remoteTag.status !== 2)
    throw new CliError(`Could not check origin for tag ${tag}.`);
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** Undo the release's file edits after a failure before the commit exists. */
function restoreWorkingTree() {
  git(["restore", "--staged", "--worktree", "--", "."], { allowFailure: true });
}

await defineCli(import.meta.url, async (argv) => {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flags = parseCli(
    "pnpm release:tag X.Y.Z",
    {
      "dry-run": {
        type: "boolean",
        description: "check preconditions and print the plan; change nothing",
      },
      yes: {
        type: "boolean",
        description: "push without asking (still requires every check to pass)",
      },
    },
    argv.filter((arg) => arg.startsWith("--")),
  );
  if (positional.length !== 1)
    throw new CliError("Usage: pnpm release:tag X.Y.Z [--dry-run] [--yes]");
  const version = assertReleaseVersion(positional[0]!);
  const tag = `v${version}`;

  assertReadyToRelease(tag);

  if (flags["dry-run"]) {
    const { releases } = await releaseDraftMigrations(repoRoot, version, {
      dryRun: true,
    });
    console.log(`Dry run for ${tag} on ${RELEASE_BRANCH}: preconditions pass.`);
    console.log(
      releases.length
        ? `Migration steps to release in ${version}:\n${releases
            .map(
              (r) =>
                `  ${r.id} (${r.checksum.slice(0, 8)}${r.staleLabel ? `; stale draft label ${r.staleLabel.slice(0, 8)} kept as previous checksum` : ""})`,
            )
            .join("\n")}`
        : "No draft migration steps to release.",
    );
    console.log(
      `Would commit "chore(release): bump version to ${tag}", tag ${tag}, and push both to origin/${RELEASE_BRANCH}.`,
    );
    return;
  }

  try {
    const changedPaths = await setWorkspaceVersion(repoRoot, version);
    if (!changedPaths.length)
      throw new CliError(`Workspace manifests already use version ${version}.`);
    await assertWorkspaceVersionsMatch(repoRoot);
    const discover = await stampPendingDiscoverRelease(repoRoot, version);
    const migrations = await releaseDraftMigrations(repoRoot, version);
    if (migrations.changedPaths.length)
      run("pnpm", ["exec", "oxfmt", ...migrations.changedPaths]);

    console.log(`Updated workspace manifests to ${version}.`);
    if (discover.changedPath)
      console.log(
        `Stamped ${discover.count} pending Discover announcement(s).`,
      );
    for (const release of migrations.releases)
      console.log(
        `Released migration ${release.id}${release.staleLabel ? ` (stale draft label kept as previous checksum)` : ""}.`,
      );

    // The released checksums must match the step folders exactly.
    run("pnpm", ["exec", "tsx", "scripts/storage-migrations/check.ts"]);

    git(["add", "--", ...VERSION_FILES, ...migrations.changedPaths]);
    if (
      git(["diff", "--cached", "--quiet"], { allowFailure: true }).status === 0
    )
      throw new CliError(`No release changes were staged for ${tag}.`);
    run("git", [
      "commit",
      "-S",
      "-m",
      `chore(release): bump version to ${tag}`,
    ]);
  } catch (error) {
    restoreWorkingTree();
    throw error;
  }

  if (!/^gpgsig/m.test(git(["cat-file", "commit", "HEAD"]).stdout)) {
    git(["reset", "--hard", "HEAD~1"]);
    throw new CliError(
      `The release commit was not signed; it was removed. Configure commit signing and retry.`,
    );
  }
  git(["tag", "-a", tag, "-m", `Release ${tag}`]);
  console.log(`Created signed release commit and tag ${tag}.`);

  const push =
    flags.yes ||
    (await confirm(`Push ${RELEASE_BRANCH} and ${tag} to origin?`));
  if (!push) {
    console.log(
      `Not pushed. To publish, run:\n  git push --atomic origin ${RELEASE_BRANCH} refs/tags/${tag}`,
    );
    return;
  }
  // Atomic: the commit and the tag land together or not at all.
  run("git", [
    "push",
    "--atomic",
    "origin",
    RELEASE_BRANCH,
    `refs/tags/${tag}`,
  ]);
  console.log(
    `Pushed ${RELEASE_BRANCH} and ${tag}; the Publish Release workflow will now start.`,
  );
});
