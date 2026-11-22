#!/usr/bin/env node
// Commit the prepared release (the working-tree changes left by
// prepare-release.ts) to a new branch through the GitHub GraphQL
// `createCommitOnBranch` mutation. GitHub signs commits it creates through the
// API, which satisfies the `main` ruleset's signature rule without a signing
// key in CI. Runs under plain Node in Release: Cut.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo \
//     node scripts/release/commit-release.ts <branch> <base-sha> <message>
//
// Prints the commit SHA and writes `sha=<oid>` to $GITHUB_OUTPUT when set.
import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, defineCli } from "../cli/main.ts";
import { repoRoot } from "../workspace/repo.ts";

export interface FileChanges {
  additions: { path: string }[];
  deletions: { path: string }[];
}

/** Classify `git status --porcelain=v1 -z` entries. Renames and copies are rejected. */
export function parsePorcelain(output: string): FileChanges {
  const changes: FileChanges = { additions: [], deletions: [] };
  for (const entry of output.split("\0")) {
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (/[RC]/.test(status))
      throw new Error(`Unsupported rename or copy in release changes: ${path}`);
    if (status.includes("D")) changes.deletions.push({ path });
    else changes.additions.push({ path });
  }
  return changes;
}

function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new CliError(`git ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout;
}

async function github(path: string, body: unknown) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new CliError("GITHUB_TOKEN is required.");
  const response = await fetch(`https://api.github.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as {
    errors?: unknown;
    data?: unknown;
  };
  if (!response.ok || json.errors)
    throw new CliError(
      `GitHub ${path} failed (${response.status}): ${JSON.stringify(json)}`,
    );
  return json;
}

await defineCli(import.meta.url, async (argv) => {
  const [branch, base, message] = argv;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!branch || !base || !message || !repository)
    throw new CliError(
      "Usage: GITHUB_REPOSITORY=owner/repo node scripts/release/commit-release.ts <branch> <base-sha> <message>",
    );
  if (git(["rev-parse", "HEAD"]).trim() !== base)
    throw new CliError(`HEAD is not the release base ${base}.`);

  const changes = parsePorcelain(
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  );
  if (!changes.additions.length && !changes.deletions.length)
    throw new CliError("No release changes in the working tree.");
  const additions = await Promise.all(
    changes.additions.map(async ({ path }) => ({
      path,
      contents: (await readFile(join(repoRoot, path))).toString("base64"),
    })),
  );

  await github(`/repos/${repository}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: base,
  });
  const result = (await github("/graphql", {
    query: `mutation ($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repository, branchName: branch },
        message: { headline: message },
        expectedHeadOid: base,
        fileChanges: { additions, deletions: changes.deletions },
      },
    },
  })) as { data: { createCommitOnBranch: { commit: { oid: string } } } };
  const sha = result.data.createCommitOnBranch.commit.oid;

  // The commit must hold exactly the prepared tree.
  git(["fetch", "--quiet", "--depth=1", "origin", sha]);
  const drift = spawnSync("git", ["diff", "--quiet", sha, "--"], {
    cwd: repoRoot,
  });
  if (drift.status !== 0)
    throw new CliError(
      `Release commit ${sha} differs from the prepared working tree.`,
    );

  console.log(
    `Committed ${changes.additions.length + changes.deletions.length} file(s) to ${branch}: ${sha}`,
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
});
