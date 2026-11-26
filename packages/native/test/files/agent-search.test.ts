import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeTempDir } from "@nervekit/test-kit";
import { files } from "../../src/index.js";

async function project(t: Parameters<typeof makeTempDir>[0]): Promise<string> {
  const root = await makeTempDir(t, "nerve-agent-search-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/b.ts"), "needle\nx\nneedle\n");
  await writeFile(join(root, "src/a.ts"), "x\nneedle\n");
  await writeFile(join(root, "c.md"), "needle\n");
  return root;
}

test("grep returns path-ordered lines with exact caps, context and totals", async (t) => {
  const root = await project(t);
  const result = await files.grep(root, [root], {
    pattern: "needle",
    limit: 2,
    context: 1,
  });
  assert.deepEqual(
    result.lines.map((l) => `${l.path}${l.isMatch ? ":" : "-"}${l.line}`),
    ["c.md:1", "src/a.ts-1", "src/a.ts:2"],
  );
  assert.equal(result.totalMatches, 4);
  assert.equal(result.totalFiles, 3);
  const single = await files.grep(root, [join(root, "src/b.ts")], {
    pattern: "needle",
    limit: 10,
  });
  assert.deepEqual(
    single.lines.map((l) => l.path),
    ["src/b.ts", "src/b.ts"],
  );
});

test("findFiles lists the first matches by path with an exact total", async (t) => {
  const root = await project(t);
  const result = await files.findFiles(root, { pattern: "*.ts", limit: 1 });
  assert.deepEqual(result.paths, ["src/a.ts"]);
  assert.equal(result.total, 2);
});

test("searches reject with the abort reason when the signal is already aborted", async (t) => {
  const root = await project(t);
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await assert.rejects(
    files.grep(root, [root], {
      pattern: "needle",
      limit: 1,
      signal: controller.signal,
    }),
    /stop/,
  );
});
