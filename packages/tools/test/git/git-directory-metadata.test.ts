import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  canonicalGitIdentity,
  GIT_DIRECTORY_METADATA_MAX_BYTES,
} from "../../src/git/git-operation-lanes.js";
const exec = promisify(execFile);

void test("Git marker and commondir reads reject empty/oversized/nonregular metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-metadata-unit-"));
  try {
    for (const common of [false, true])
      for (const bytes of [0, GIT_DIRECTORY_METADATA_MAX_BYTES + 1]) {
        const dir = join(root, `${common ? "common" : "marker"}-${bytes}`);
        await mkdir(dir);
        if (common) await mkdir(join(dir, ".git"));
        await writeFile(
          join(dir, ".git", ...(common ? ["commondir"] : [])),
          Buffer.alloc(bytes, 65),
        );
        await assert.rejects(canonicalGitIdentity(dir), /metadata/);
      }
    const directory = join(root, "directory");
    await mkdir(join(directory, ".git", "commondir"), { recursive: true });
    await assert.rejects(canonicalGitIdentity(directory));
    const invalid = join(root, "invalid-utf8");
    await mkdir(invalid);
    await writeFile(join(invalid, ".git"), Buffer.from([0xff, 0xfe, 0xfd]));
    await assert.rejects(canonicalGitIdentity(invalid));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
void test("the byte boundary is enforced without changing actual canonical I/O paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-metadata-boundary-"));
  try {
    const real = join(root, "real", ".git");
    await mkdir(real, { recursive: true });
    const dir = join(root, "worktree");
    await mkdir(dir);
    const marker = "gitdir: ../real/.git";
    await writeFile(
      join(dir, ".git"),
      marker +
        "\n".repeat(
          GIT_DIRECTORY_METADATA_MAX_BYTES - Buffer.byteLength(marker),
        ),
    );
    assert.deepEqual(await canonicalGitIdentity(dir), {
      gitDir: await realpath(real),
      commonDir: await realpath(real),
    });
    await writeFile(
      join(dir, ".git"),
      marker +
        "\n".repeat(
          GIT_DIRECTORY_METADATA_MAX_BYTES + 1 - Buffer.byteLength(marker),
        ),
    );
    await assert.rejects(canonicalGitIdentity(dir), /metadata/);
    const nested = join(root, "nested");
    await mkdir(nested);
    await mkdir(join(root, ".git"));
    await writeFile(join(nested, ".git"), "gitdir: ../missing\n");
    await assert.rejects(
      canonicalGitIdentity(nested),
      "malformed nearest metadata must not fall back to an ancestor repository",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
void test(
  "device metadata is rejected before any unbounded read",
  { skip: process.platform === "win32", timeout: 2000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-git-metadata-device-"));
    try {
      await symlink("/dev/zero", join(root, ".git"));
      await assert.rejects(canonicalGitIdentity(root), /regular/);
      await rm(join(root, ".git"));
      await mkdir(join(root, ".git"));
      await symlink("/dev/zero", join(root, ".git", "commondir"));
      await assert.rejects(canonicalGitIdentity(root), /regular/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
void test(
  "FIFO common metadata does not wait for a writer and cleanup cannot leave a blocked reader",
  { skip: process.platform === "win32", timeout: 5000 },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "nerve-git-metadata-fifo-"));
    let rescue: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await mkdir(join(root, ".git"));
      const fifo = join(root, ".git", "commondir");
      try {
        await exec("mkfifo", [fifo]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          context.skip("mkfifo is unavailable");
          return;
        }
        throw error;
      }
      // If nonblocking open regresses, supply EOF so even a failing test can clean up.
      timer = setTimeout(() => {
        rescue = open(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
          .then((file) => file.close())
          .catch(() => {});
      }, 1000);
      await assert.rejects(canonicalGitIdentity(root), /regular/);
      assert.equal(
        rescue,
        undefined,
        "metadata admission must not need a FIFO writer",
      );
    } finally {
      clearTimeout(timer);
      await rescue;
      await rm(root, { recursive: true, force: true });
    }
  },
);
