import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ChangeMonitor, files, type ChangeNotice } from "../../src/index.js";
import { waitFor } from "../support/wait-for.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-files-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules/pkg"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "node_modules/\n");
  await writeFile(join(root, "src/main.ts"), "const needle = 1;\n");
  await writeFile(join(root, "node_modules/pkg/index.js"), "needle\n");
  return root;
}

test("listing, path index and content search honor ignore rules", async () => {
  assert.equal(files.isAvailable(), true);
  const root = await fixture();
  try {
    const entries = await files.listDirectory(root, "");
    assert.deepEqual(
      entries.map((e) => [e.name, e.kind, e.ignored]),
      [
        ["node_modules", "directory", true],
        ["src", "directory", false],
        [".gitignore", "file", false],
      ],
    );
    const index = files.createPathIndex(root);
    try {
      await waitFor(async () => !(await index.search("main")).incomplete, {
        message: "path index to complete",
      });
      const result = await index.search("main");
      assert.deepEqual(
        result.matches.map((m) => m.path),
        ["src/main.ts"],
      );
      await writeFile(join(root, "src/added.ts"), "");
      await index.applyChanges(["src/added.ts"]);
      assert.equal((await index.search("added")).matches.length, 1);
    } finally {
      index.close();
    }
    const content = await files.searchContent(root, { query: "needle" });
    assert.deepEqual(
      content.files.map((f) => f.path),
      ["src/main.ts"],
    );
    assert.deepEqual(content.files[0]?.matches[0]?.ranges, [[6, 12]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tree monitor reports changes outside ignored directories only", async (t) => {
  if (!ChangeMonitor.supportsTreeScopes()) return t.skip();
  const root = await fixture();
  const notices: ChangeNotice[] = [];
  const monitor = new ChangeMonitor((notice) => notices.push(notice));
  try {
    const state = await monitor.syncTree({
      id: "tree",
      root,
      pollIntervalMs: 600_000,
    });
    assert.equal(state.degraded, false);
    const saw = (name: string) =>
      notices.some((n) => n.paths.some((p) => p.endsWith(name)));
    // FSEvents (macOS) may replay the fixture's own writes just after the
    // stream starts. Events are delivered in order, so once a barrier file is
    // seen everything earlier has been reported and can be discarded.
    await writeFile(join(root, "src/barrier-1.ts"), "x");
    await waitFor(() => saw("barrier-1.ts"), { message: "first barrier" });
    notices.length = 0;
    await writeFile(join(root, "node_modules/pkg/ignored.js"), "x");
    await writeFile(join(root, "src/barrier-2.ts"), "x");
    await waitFor(() => saw("barrier-2.ts"), { message: "second barrier" });
    assert.deepEqual(
      notices.flatMap((notice) =>
        notice.paths.filter((path) => path.includes("node_modules")),
      ),
      [],
    );
    await mkdir(join(root, "src/new/deeper"), { recursive: true });
    await writeFile(join(root, "src/new/deeper/file.ts"), "x");
    await waitFor(
      () => notices.some((n) => n.paths.some((p) => p.endsWith("new"))),
      {
        message: "new notice",
      },
    );
    await writeFile(join(root, "src/new/deeper/second.ts"), "x");
    await waitFor(() => saw("second.ts"), { message: "second.ts notice" });
  } finally {
    await monitor.close();
    await rm(root, { recursive: true, force: true });
  }
});
