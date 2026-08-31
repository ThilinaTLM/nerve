import type { GitStashArea, GitStashEntry } from "@nervekit/contracts/git";
import { GitWorkflowError } from "./git-errors.js";
import type { GitService } from "./git-service.js";

const STASH_REF_PATTERN = /^stash@\{(\d+)\}$/;

export function parseStashList(output: string): GitStashEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [ref = "", hash = "", message = "", relativeDate = ""] =
        line.split("\u0000");
      const match = STASH_REF_PATTERN.exec(ref);
      if (!match || !hash) return [];
      return [
        {
          index: Number.parseInt(match[1] ?? "", 10),
          ref,
          hash,
          message,
          relativeDate,
        },
      ];
    });
}

export async function listStashes(
  service: GitService,
  repoDir: string,
): Promise<GitStashEntry[]> {
  const { stdout } = await service.runGit(repoDir, [
    "stash",
    "list",
    "--format=%gd%x00%H%x00%gs%x00%cr",
  ]);
  return parseStashList(stdout);
}

export function stashCreateArgs(
  area: GitStashArea,
  paths?: readonly string[],
): string[] {
  const args =
    area === "staged"
      ? ["stash", "push", "--staged"]
      : ["stash", "push", "--keep-index", "--include-untracked"];
  const uniquePaths = paths ? [...new Set(paths)] : [];
  if (uniquePaths.length > 0) args.push("--", ...uniquePaths);
  return args;
}

export async function createAreaStash(
  service: GitService,
  repoDir: string,
  area: GitStashArea,
  paths?: readonly string[],
): Promise<void> {
  if (area === "unstaged") {
    await service.runGit(repoDir, stashCreateArgs(area, paths));
    return;
  }

  // Git cannot always remove staged hunks when the same path also has
  // unstaged hunks. Temporarily stash only paths with an unstaged side, create
  // the requested staged stash, then restore the temporary entry by its hash.
  const temporaryPaths = await unstagedPathspecs(service, repoDir, paths);
  if (temporaryPaths.length === 0) {
    await service.runGit(repoDir, stashCreateArgs("staged", paths));
    return;
  }

  const before = (await listStashes(service, repoDir))[0]?.hash;
  const temporaryArgs = stashCreateArgs("unstaged", temporaryPaths);
  temporaryArgs.splice(temporaryArgs.indexOf("--include-untracked"), 1);
  temporaryArgs.splice(
    temporaryArgs.indexOf("--"),
    0,
    "--message",
    "Nerve temporary unstaged changes",
  );
  await service.runGit(repoDir, temporaryArgs);
  const temporary = (await listStashes(service, repoDir))[0];
  const temporaryCreated = temporary && temporary.hash !== before;

  try {
    await service.runGit(repoDir, stashCreateArgs("staged", paths));
  } catch (error) {
    if (temporaryCreated)
      await restoreTemporaryStash(
        service,
        repoDir,
        temporary.hash,
        temporaryPaths,
      );
    throw error;
  }

  if (temporaryCreated)
    await restoreTemporaryStash(
      service,
      repoDir,
      temporary.hash,
      temporaryPaths,
    );
}

async function unstagedPathspecs(
  service: GitService,
  repoDir: string,
  paths?: readonly string[],
): Promise<string[]> {
  const suffix = paths && paths.length > 0 ? ["--", ...paths] : [];
  const { stdout } = await service.runGit(repoDir, [
    "diff",
    "--name-only",
    ...suffix,
  ]);
  return [
    ...new Set(
      stdout
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ];
}

async function restoreTemporaryStash(
  service: GitService,
  repoDir: string,
  hash: string,
  paths: readonly string[],
): Promise<void> {
  const entry = (await listStashes(service, repoDir)).find(
    (candidate) => candidate.hash === hash,
  );
  if (!entry) {
    throw new GitWorkflowError(
      409,
      "GIT_STASH_CHANGED",
      "The temporary stash changed before it could be restored.",
    );
  }
  await service.runGit(repoDir, [
    "restore",
    `--source=${hash}`,
    "--worktree",
    "--",
    ...paths,
  ]);
  await service.runGit(repoDir, ["stash", "drop", entry.ref]);
}

export async function stashApplyArgs(
  service: GitService,
  repoDir: string,
  ref: string,
): Promise<string[]> {
  const { stdout } = await service.runGit(repoDir, [
    "diff",
    "--name-only",
    `${ref}^2`,
    ref,
  ]);
  return stdout.trim().length === 0
    ? ["stash", "apply", "--index", ref]
    : ["stash", "apply", ref];
}

export async function verifyStashTarget(
  service: GitService,
  repoDir: string,
  index: number,
  expectedHash: string,
): Promise<string> {
  const ref = `stash@{${index}}`;
  let actualHash: string;
  try {
    actualHash = (
      await service.runGit(repoDir, [
        "rev-parse",
        "--verify",
        `${ref}^{commit}`,
      ])
    ).stdout.trim();
  } catch {
    throw staleStashError();
  }
  if (actualHash !== expectedHash) throw staleStashError();
  return ref;
}

function staleStashError(): GitWorkflowError {
  return new GitWorkflowError(
    409,
    "GIT_STASH_CHANGED",
    "The stash list changed. Refresh and try again.",
  );
}
