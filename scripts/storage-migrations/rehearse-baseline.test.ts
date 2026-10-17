import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  hashRehearsalFile,
  writeRehearsalBaseline,
} from "./rehearse-baseline.js";

test("streamed hashing consumes many bounded chunks and handles empty files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-rehearsal-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "sqlite");
  const payload = Buffer.from("0123456789abcdef".repeat(1024));
  await writeFile(file, payload);
  assert.equal(
    await hashRehearsalFile(file, 7),
    createHash("sha256").update(payload).digest("hex"),
  );
  await writeFile(file, "");
  assert.equal(
    await hashRehearsalFile(file, 7),
    createHash("sha256").digest("hex"),
  );
  await assert.rejects(hashRehearsalFile(join(root, "missing")), {
    code: "ENOENT",
  });
});

test("baseline streams deterministic sha256sum lines and publishes atomically with private mode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-rehearsal-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home"),
    projects = join(root, "projects"),
    output = join(root, "baseline.sha");
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(projects);
  const paths = [
    join(home, "data/nerve.sqlite"),
    join(home, "manifest.json"),
    join(projects, "config.json"),
  ];
  for (const path of paths) await writeFile(path, path);
  await writeFile(output, "old baseline");
  await chmod(output, 0o644);
  await writeRehearsalBaseline(home, projects, output);
  const expected = paths
    .map(
      (path) => `${createHash("sha256").update(path).digest("hex")}  ${path}\n`,
    )
    .join("");
  assert.equal(await readFile(output, "utf8"), expected);
  assert.equal((await lstat(output)).mode & 0o777, 0o600);
  await symlink(paths[0]!, join(projects, "unsafe"));
  await assert.rejects(
    writeRehearsalBaseline(home, projects, output),
    /linked or special/,
  );
  assert.equal(await readFile(output, "utf8"), expected);
  assert.deepEqual((await readdir(root)).sort(), [
    "baseline.sha",
    "home",
    "projects",
  ]);
});
