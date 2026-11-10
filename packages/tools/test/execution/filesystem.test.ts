import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_MAX_BYTES } from "../../src/execution/output/truncate.js";
import { executeLs } from "../../src/execution/filesystem/list.js";
import { executeRead } from "../../src/execution/filesystem/read.js";
import { executeWrite } from "../../src/execution/filesystem/write.js";
import { createTempProject } from "../support/project-fixtures.js";

describe("filesystem executors", () => {
  it("reports write outcomes, UTF-8 bytes and complete directory totals", async () => {
    const project = await createTempProject();
    const created = await executeWrite(
      { path: "one.txt", content: "é" },
      { cwd: project.root },
    );
    assert.equal(created.details?.outcome, "created");
    assert.equal(created.details?.bytes, 2);
    assert.equal(created.content, "Created one.txt (2 B).");
    const overwritten = await executeWrite(
      { path: "one.txt", content: "ok" },
      { cwd: project.root },
    );
    assert.equal(overwritten.details?.outcome, "overwritten");
    assert.equal(overwritten.content, "Overwrote one.txt (2 B).");
    await project.write("two.txt", "two");
    const listing = await executeLs(
      { path: ".", limit: 1 },
      { cwd: project.root },
    );
    assert.equal(listing.entries?.length, 1);
    assert.equal(listing.details?.totalEntries, 2);
  });
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
    // The model's own limit ended the window: no Next.
    assert.equal(window.content, "two\nthree\n\nLines 2-3 of 4");

    const eof = await executeRead(
      { path: "notes.txt", offset: 4, limit: 10 },
      { cwd: project.root },
    );
    assert.equal(eof.content, "four\n\nLines 4-4 of 4");
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
    assert.match(
      result.content ?? "",
      /\n\nLines 1-2000 of 2002\. Next: \{"offset":2001\}$/,
    );
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
    assert.match(
      result.content ?? "",
      /Line 1 cut at 4096 chars\. Rest: \{"byteOffset":4096\}$/,
    );
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
    assert.match(result.content ?? "", /Rest: \{"byteOffset":4096\}$/);
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
    // The model chose byteLimit 32: no Next.
    assert.match(result.content ?? "", /\n\nBytes 4995-5026 of 10006$/);
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

  it("adds Next only when the tool imposed the cut", async () => {
    const project = await createTempProject();
    await project.write(
      "big.txt",
      Array.from({ length: 6000 }, (_, index) => `l${index + 1}`).join("\n"),
    );
    await project.write("bytes.txt", "x".repeat(10006));
    const cwd = { cwd: project.root };

    const tail = await executeRead({ path: "big.txt", offset: 5990 }, cwd);
    assert.match(tail.content ?? "", /\n\nLines 5990-6000 of 6000$/);

    const byDefaultLimit = await executeRead(
      { path: "big.txt", offset: 10 },
      cwd,
    );
    assert.match(
      byDefaultLimit.content ?? "",
      /\n\nLines 10-2009 of 6000\. Next: \{"offset":2010\}$/,
    );

    const clamped = await executeRead({ path: "big.txt", limit: 9000 }, cwd);
    assert.match(
      clamped.content ?? "",
      /\n\nLines 1-5000 of 6000\. limit clamped to 5000\. Next: \{"offset":5001\}$/,
    );

    const ownWindow = await executeRead(
      { path: "big.txt", offset: 5, limit: 3 },
      cwd,
    );
    assert.match(ownWindow.content ?? "", /\n\nLines 5-7 of 6000$/);

    const bytes = await executeRead({ path: "bytes.txt", byteOffset: 0 }, cwd);
    assert.match(
      bytes.content ?? "",
      /\n\nBytes 0-4095 of 10006\. Next: \{"byteOffset":4096\}$/,
    );

    const bytesClamped = await executeRead(
      { path: "bytes.txt", byteLimit: 99999 },
      cwd,
    );
    assert.match(
      bytesClamped.content ?? "",
      /\n\nBytes 0-4095 of 10006\. byteLimit clamped to 4096\. Next: \{"byteOffset":4096\}$/,
    );

    const bytesOwn = await executeRead(
      { path: "bytes.txt", byteLimit: 100 },
      cwd,
    );
    assert.match(bytesOwn.content ?? "", /\n\nBytes 0-99 of 10006$/);
  });

  it("prints no trailer when the whole file is returned", async () => {
    const project = await createTempProject();
    await project.write("small.txt", "a\nb\n");
    await project.write("tiny.bin.txt", "abc");
    const cwd = { cwd: project.root };
    assert.equal(
      (await executeRead({ path: "small.txt" }, cwd)).content,
      "a\nb",
    );
    assert.equal(
      (await executeRead({ path: "small.txt", offset: 1, limit: 50 }, cwd))
        .content,
      "a\nb",
    );
    assert.equal(
      (await executeRead({ path: "tiny.bin.txt", byteLimit: 100 }, cwd))
        .content,
      "abc",
    );
  });

  it("rejects invalid and missing read paths with actionable errors", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeRead({}, { cwd: process.cwd() }),
      /path.*non-empty string/,
    );
    await assert.rejects(
      executeRead({ path: "missing.txt" }, { cwd: project.root }),
      /path not found: missing\.txt\nNearest existing directory \.\/ contains: /,
    );
  });

  it("writes files atomically, creates parents, overwrites, and reports bytes", async () => {
    const project = await createTempProject();
    const first = await executeWrite(
      { path: "nested/out.txt", content: "snowman ☃" },
      { cwd: project.root },
    );
    assert.equal(first.path, join(project.root, "nested/out.txt"));
    assert.equal(first.content, "Created nested/out.txt (11 B).");
    assert.equal(first.details?.bytesWritten, 11);
    assert.deepEqual(first.details?.mutationSummary, {
      operation: "write",
      outcome: "succeeded",
      resources: [{ kind: "file", path: first.path }],
      warnings: [],
    });
    assert.equal(await readFile(first.path ?? "", "utf8"), "snowman ☃");

    const second = await executeWrite(
      { path: "nested/out.txt", content: "ok" },
      { cwd: project.root },
    );
    assert.equal(second.content, "Overwrote nested/out.txt (2 B).");
    assert.equal(await readFile(first.path ?? "", "utf8"), "ok");
  });

  it("rejects missing ls paths with actionable errors", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeLs({ path: "missing" }, { cwd: project.root }),
      /path not found: missing\nNearest existing directory \.\/ contains: /,
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
      /not a directory: file\.txt is a file\. Use read\./,
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
    assert.equal(limited.details?.totalEntries, 3);
    assert.equal(limited.details?.returnedEntries, 2);
    assert.equal(limited.details?.producerLimitReached, true);

    const full = await executeLs({ path: "." }, { cwd: project.root });
    assert.deepEqual(full.entries, [
      { path: "A.txt", kind: "file" },
      { path: "b.txt", kind: "file" },
      { path: "dir/", kind: "directory" },
    ]);
  });
});
