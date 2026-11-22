#!/usr/bin/env node
// Prepare a release in the working tree: bump every workspace version, stamp
// pending Discover news, mark draft migration steps released and check the
// migration lock. Commits, tags and pushes nothing; the Release: Cut workflow
// commits the result, tests it and tags it.
//
//   pnpm release:prepare X.Y.Z [--dry-run]
import { spawnSync } from "node:child_process";
import { CliError, defineCli } from "../cli/main.ts";
import { parseCli } from "../cli/args.ts";
import { repoRoot } from "../workspace/repo.ts";
import { stampPendingDiscoverRelease } from "./discover-release.ts";
import { releaseDraftMigrations } from "./release-migrations.ts";
import { setWorkspaceVersion } from "./release-version.ts";
import { assertWorkspaceVersionsMatch } from "./workspace-packages.ts";

const PLAIN_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parsePlainVersion(version: string): [number, number, number] {
  const match = PLAIN_SEMVER.exec(version);
  if (!match)
    throw new CliError(
      `Invalid release version ${JSON.stringify(version)}. Expected plain SemVer X.Y.Z (no leading v, no pre-release or build suffix).`,
    );
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Channels are npm dist-tags, so every release is plain SemVer above the current version. */
export function assertNextReleaseVersion(current: string, next: string) {
  const nextParts = parsePlainVersion(next);
  const currentMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!currentMatch)
    throw new CliError(`Current version ${current} is not SemVer.`);
  const currentParts = currentMatch.slice(1, 4).map(Number);
  const order = nextParts.findIndex(
    (part, index) => part !== currentParts[index],
  );
  if (order === -1 || nextParts[order]! < currentParts[order]!)
    throw new CliError(
      `Release version ${next} must be greater than the current version ${current}.`,
    );
  return next;
}

function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout.trim() };
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new CliError(`${command} ${args.join(" ")} failed`);
}

function assertTagIsFree(tag: string) {
  if (
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).status === 0
  )
    throw new CliError(`Tag ${tag} already exists locally.`);
  const remote = git([
    "ls-remote",
    "--exit-code",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
  ]);
  if (remote.status === 0)
    throw new CliError(`Tag ${tag} already exists on origin.`);
  if (remote.status !== 2)
    throw new CliError(`Could not check origin for tag ${tag}.`);
}

await defineCli(import.meta.url, async (argv) => {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flags = parseCli(
    "pnpm release:prepare X.Y.Z",
    {
      "dry-run": {
        type: "boolean",
        description: "check preconditions and print the plan; change nothing",
      },
    },
    argv.filter((arg) => arg.startsWith("--")),
  );
  if (positional.length !== 1)
    throw new CliError("Usage: pnpm release:prepare X.Y.Z [--dry-run]");
  const current = await assertWorkspaceVersionsMatch(repoRoot);
  if (!current) throw new CliError("The root package.json has no version.");
  const version = assertNextReleaseVersion(current, positional[0]!);
  const tag = `v${version}`;

  if (git(["status", "--porcelain", "--untracked-files=normal"]).stdout)
    throw new CliError("The working tree must be clean before a release.");
  assertTagIsFree(tag);

  if (flags["dry-run"]) {
    const { releases } = await releaseDraftMigrations(repoRoot, version, {
      dryRun: true,
    });
    console.log(`Dry run for ${tag} (from ${current}): preconditions pass.`);
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
    return;
  }

  await setWorkspaceVersion(repoRoot, version);
  await assertWorkspaceVersionsMatch(repoRoot);
  const discover = await stampPendingDiscoverRelease(repoRoot, version);
  const migrations = await releaseDraftMigrations(repoRoot, version);
  if (migrations.changedPaths.length)
    run("pnpm", ["exec", "oxfmt", ...migrations.changedPaths]);

  console.log(`Updated workspace manifests to ${version}.`);
  if (discover.changedPath)
    console.log(`Stamped ${discover.count} pending Discover announcement(s).`);
  for (const release of migrations.releases)
    console.log(
      `Released migration ${release.id}${release.staleLabel ? ` (stale draft label kept as previous checksum)` : ""}.`,
    );

  // The released checksums must match the step folders exactly.
  run("pnpm", ["exec", "tsx", "scripts/storage-migrations/check.ts"]);
  console.log(
    `Prepared ${tag}. The working tree holds the release changes; nothing was committed.`,
  );
});
