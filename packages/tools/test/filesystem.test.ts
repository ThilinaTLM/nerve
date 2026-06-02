import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  executeLs,
  executeRead,
  executeWrite,
} from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

describe("filesystem executors", () => {
  it("reads full files and line windows with continuation markers", async () => {
    const project = await createTempProject();
    await project.write("notes.txt", "one\ntwo\nthree\nfour");

    const full = await executeRead(
      { path: "notes.txt" },
      { cwd: project.root },
    );
    assert.equal(full.content, "one\ntwo\nthree\nfour");
    assert.equal(full.path, join(project.root, "notes.txt"));

    const window = await executeRead(
      { path: "notes.txt", offset: 2, limit: 2 },
      { cwd: project.root },
    );
    assert.equal(
      window.content,
      "two\nthree\n\n[...1 more lines. Continue with offset 4.]",
    );

    const eof = await executeRead(
      { path: "notes.txt", offset: 4, limit: 10 },
      { cwd: project.root },
    );
    assert.equal(eof.content, "four");
  });

  it("rejects missing read paths", async () => {
    await assert.rejects(
      executeRead({}, { cwd: process.cwd() }),
      /path.*non-empty string/,
    );
  });

  it("writes files atomically, creates parents, overwrites, and reports bytes", async () => {
    const project = await createTempProject();
    const first = await executeWrite(
      { path: "nested/out.txt", content: "snowman ☃" },
      { cwd: project.root },
    );
    assert.equal(first.path, join(project.root, "nested/out.txt"));
    assert.equal(first.content, "Wrote 11 bytes.");
    assert.equal(await readFile(first.path ?? "", "utf8"), "snowman ☃");

    const second = await executeWrite(
      { path: "nested/out.txt", content: "ok" },
      { cwd: project.root },
    );
    assert.equal(second.content, "Wrote 2 bytes.");
    assert.equal(await readFile(first.path ?? "", "utf8"), "ok");
  });

  it("lists directory entries in case-insensitive order with kinds and limits", async () => {
    const project = await createTempProject();
    await project.write("b.txt", "b");
    await project.write("A.txt", "a");
    await mkdir(join(project.root, "dir"));

    const limited = await executeLs(
      { path: ".", limit: 2 },
      { cwd: project.root },
    );
    assert.equal(limited.path, project.root);
    assert.deepEqual(limited.entries, [
      { path: "A.txt", kind: "file" },
      { path: "b.txt", kind: "file" },
    ]);

    const full = await executeLs({ path: "." }, { cwd: project.root });
    assert.deepEqual(full.entries, [
      { path: "A.txt", kind: "file" },
      { path: "b.txt", kind: "file" },
      { path: "dir/", kind: "directory" },
    ]);
  });
});
