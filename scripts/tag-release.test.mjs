import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { versionLockedPackages } from "./lib/workspace-packages.mjs";

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "tag-release.sh",
);

function commandExists(command) {
  return (
    spawnSync("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command])
      .status === 0
  );
}

const missingTool = ["bash", "git", "ssh-keygen", "script"].find(
  (command) => !commandExists(command),
);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-tag-release-"));
  const repo = join(root, "repo");
  const origin = join(root, "origin.git");
  const signingKey = join(root, "signing-key");
  await mkdir(repo);

  git(root, "init", "--bare", origin);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Release Test");
  git(repo, "config", "user.email", "release-test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "tag.gpgSign", "false");

  const packageDirectories = new Set([
    ...versionLockedPackages,
    "ui-kit",
    "website",
  ]);
  await writeFile(
    join(repo, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true }, null, 2)}\n`,
  );
  for (const directory of packageDirectories) {
    await mkdir(join(repo, "packages", directory), { recursive: true });
    await writeFile(
      join(repo, "packages", directory, "package.json"),
      `${JSON.stringify({ name: `@fixture/${directory}`, version: "1.0.0", private: true }, null, 2)}\n`,
    );
  }
  await mkdir(join(repo, "packages", "native", "native"), {
    recursive: true,
  });
  await writeFile(
    join(repo, "packages", "native", "native", "Cargo.toml"),
    '[package]\nname = "nerve-native"\nversion = "1.0.0"\nedition = "2024"\n',
  );
  await writeFile(
    join(repo, "Cargo.lock"),
    '# Generated fixture\nversion = 4\n\n[[package]]\nname = "nerve-native"\nversion = "1.0.0"\n',
  );

  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-u", "origin", "main");
  const initialCommit = git(repo, "rev-parse", "HEAD");

  execFileSync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    signingKey,
  ]);
  git(repo, "config", "gpg.format", "ssh");
  git(repo, "config", "user.signingkey", signingKey);

  return { initialCommit, origin, repo, root };
}

function runRelease(repo, version, input = "") {
  return spawnSync("bash", [scriptPath, version], {
    cwd: repo,
    encoding: "utf8",
    input,
  });
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

test(
  "creates a signed release commit and local annotated tag without pushing non-interactively",
  { skip: missingTool && `requires ${missingTool}` },
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.root, { recursive: true, force: true }));

    const result = runRelease(fixture.repo, "1.1.0", "n\n");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No interactive terminal is available/);
    assert.equal(
      git(fixture.repo, "show", "HEAD:package.json").includes(
        '"version": "1.1.0"',
      ),
      true,
    );
    assert.equal(
      git(fixture.repo, "show", "HEAD:packages/website/package.json").includes(
        '"version": "1.1.0"',
      ),
      true,
    );
    assert.equal(
      git(fixture.repo, "cat-file", "-t", "refs/tags/v1.1.0"),
      "tag",
    );
    assert.match(git(fixture.repo, "cat-file", "commit", "HEAD"), /^gpgsig /m);
    assert.equal(
      spawnSync(
        "git",
        [
          "--git-dir",
          fixture.origin,
          "rev-parse",
          "--verify",
          "refs/tags/v1.1.0",
        ],
        { stdio: "ignore" },
      ).status,
      128,
    );
  },
);

test(
  "pushes only the tag after interactive confirmation",
  { skip: missingTool && `requires ${missingTool}` },
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.root, { recursive: true, force: true }));

    const command = `${shellQuote(scriptPath)} 1.2.0`;
    const result = spawnSync("script", ["-qefc", command, "/dev/null"], {
      cwd: fixture.repo,
      encoding: "utf8",
      input: "y\n",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    assert.equal(
      git(
        fixture.root,
        "--git-dir",
        fixture.origin,
        "rev-parse",
        "refs/tags/v1.2.0^{}",
      ),
      git(fixture.repo, "rev-parse", "HEAD"),
    );
    assert.equal(
      git(
        fixture.root,
        "--git-dir",
        fixture.origin,
        "rev-parse",
        "refs/heads/main",
      ),
      fixture.initialCommit,
    );
  },
);

test(
  "rejects dirty worktrees and existing tags before changing versions",
  { skip: missingTool && `requires ${missingTool}` },
  async (context) => {
    const dirty = await createFixture();
    const tagged = await createFixture();
    context.after(() =>
      Promise.all(
        [dirty.root, tagged.root].map((root) =>
          rm(root, { recursive: true, force: true }),
        ),
      ),
    );

    await writeFile(join(dirty.repo, "untracked.txt"), "dirty\n");
    const dirtyResult = runRelease(dirty.repo, "1.1.0");
    assert.notEqual(dirtyResult.status, 0);
    assert.match(dirtyResult.stderr, /working tree must be clean/);
    assert.equal(
      git(dirty.repo, "show", "HEAD:package.json").includes(
        '"version": "1.0.0"',
      ),
      true,
    );

    git(tagged.repo, "tag", "--no-sign", "v1.1.0");
    const taggedResult = runRelease(tagged.repo, "1.1.0");
    assert.notEqual(taggedResult.status, 0);
    assert.match(taggedResult.stderr, /already exists locally/);
    assert.equal(
      git(tagged.repo, "show", "HEAD:package.json").includes(
        '"version": "1.0.0"',
      ),
      true,
    );
  },
);
