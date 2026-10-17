import assert from "node:assert/strict";
import { test } from "node:test";
import { redirectProject, rehearseOptions } from "./rehearse-options.js";
test("rehearsal requires explicit isolated slot and valid options", () => {
  for (const args of [
    [],
    ["--from", "/tmp/home", "--slot", "1"],
    ["--from", "x", "--slot", "2", "--corrupt", "unknown"],
    ["--from", "x", "--slot", "2", "--slot", "3"],
  ])
    assert.throws(() => rehearseOptions(args));
  const options = rehearseOptions(
    [
      "--from",
      "/tmp/home",
      "--slot",
      "3",
      "--keep",
      "--force-reset",
      "--corrupt",
      "message",
    ],
    "/repo",
  );
  assert.equal(options.slot.home, "/repo/data/storage-3");
  assert.equal(options.keep, true);
  assert.equal(options.forceReset, true);
});
test("redirect preserves fields and redirects both legacy path spellings", () => {
  const source = {
    id: "project",
    dir: "/real/repo",
    directory: "/real/repo",
    other: 1,
  };
  const result = redirectProject(source, "/isolated");
  assert.deepEqual(result.document, {
    ...source,
    dir: "/isolated/repo",
    directory: "/isolated/repo",
  });
  assert.equal(source.dir, "/real/repo");
  assert.throws(() => redirectProject({}, "/isolated"));
});
