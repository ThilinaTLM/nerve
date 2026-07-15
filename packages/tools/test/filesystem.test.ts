import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_MAX_BYTES } from "../src/execution/common/truncate.js";
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

  it("reads supported image files as model-visible image attachments", async () => {
    const project = await createTempProject();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(project.root, "clipboard.png"), png);

    const result = await executeRead(
      { path: "clipboard.png" },
      { cwd: project.root },
    );

    assert.equal(result.content, "Read image file [image/png]");
    assert.equal(result.path, join(project.root, "clipboard.png"));
    assert.deepEqual(result.contentBlocks?.[0], {
      type: "text",
      text: "Read image file [image/png]",
    });
    assert.deepEqual(result.contentBlocks?.[1], {
      type: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
    });
  });

  it("reads @-prefixed paths and truncates large text with continuation guidance", async () => {
    const project = await createTempProject();
    await project.write(
      "large.txt",
      Array.from({ length: 2002 }, (_, index) => `line ${index + 1}`).join(
        "\n",
      ),
    );

    const result = await executeRead(
      { path: "@large.txt" },
      { cwd: project.root },
    );

    assert.match(result.content ?? "", /^line 1\nline 2/);
    assert.match(result.content ?? "", /output truncated/);
    assert.equal(result.contentBlocks?.[0]?.type, "text");
  });

  it("caps default reads of huge single-line text files", async () => {
    const project = await createTempProject();
    await project.write("minified.json", "a".repeat(DEFAULT_MAX_BYTES * 3));

    const result = await executeRead(
      { path: "minified.json" },
      { cwd: project.root },
    );

    assert.match(result.content ?? "", /^aaaa/);
    assert.match(result.content ?? "", /output truncated/);
    assert.match(result.content ?? "", /overlong line/);
    assert.ok(
      Buffer.byteLength(result.content ?? "", "utf8") <
        DEFAULT_MAX_BYTES + 1000,
    );
    assert.equal(result.contentBlocks?.[0]?.type, "text");
  });

  it("caps explicit line-window reads of huge single-line text files", async () => {
    const project = await createTempProject();
    await project.write("bundle.css", "b".repeat(DEFAULT_MAX_BYTES * 3));

    const result = await executeRead(
      { path: "bundle.css", offset: 1, limit: 1 },
      { cwd: project.root },
    );

    assert.match(result.content ?? "", /^bbbb/);
    assert.match(result.content ?? "", /selected output truncated/);
    assert.match(result.content ?? "", /overlong line/);
    assert.match(result.content ?? "", /byteOffset\/byteLimit/);
    assert.ok(Buffer.byteLength(result.content ?? "", "utf8") < 6000);
    assert.equal(
      (result.details as { truncation?: { nextOffset?: number } } | undefined)
        ?.truncation?.nextOffset,
      undefined,
    );
  });

  it("reads byte windows for overlong single-line text files", async () => {
    const project = await createTempProject();
    await project.write(
      "minified.js",
      `${"a".repeat(5000)}needle${"z".repeat(5000)}`,
    );

    const result = await executeRead(
      { path: "minified.js", byteOffset: 4995, byteLimit: 32 },
      { cwd: project.root },
    );

    assert.match(result.content ?? "", /^aaaaaneedlezz/);
    assert.match(result.content ?? "", /Continue with byteOffset 5027/);
    const details = result.details as {
      byteOffset?: number;
      byteLimit?: number;
      nextByteOffset?: number;
      size?: number;
    };
    assert.equal(details.byteOffset, 4995);
    assert.equal(details.byteLimit, 32);
    assert.equal(details.nextByteOffset, 5027);
    assert.equal(details.size, 10006);
  });

  it("rejects invalid and missing read paths with actionable errors", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeRead({}, { cwd: process.cwd() }),
      /path.*non-empty string/,
    );
    await assert.rejects(
      executeRead({ path: "missing.txt" }, { cwd: project.root }),
      /read path not found: "missing\.txt"/,
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

  it("rejects missing ls paths with actionable errors", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeLs({ path: "missing" }, { cwd: project.root }),
      /ls path not found: "missing"/,
    );
  });

  it("defaults blank ls paths to cwd and rejects file paths", async () => {
    const project = await createTempProject();
    await project.write("file.txt", "content");

    const result = await executeLs({ path: "  " }, { cwd: project.root });
    assert.equal(result.path, project.root);
    assert.deepEqual(result.entries, [{ path: "file.txt", kind: "file" }]);
    await assert.rejects(
      executeLs({ path: "file.txt" }, { cwd: project.root }),
      /ls path is not a directory/,
    );
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
