import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { McpTool } from "@nervekit/tools/quick-script";
import { McpToolIndex } from "./mcp-tool-index.js";

let directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "nerve-mcp-index-"));
});
after(async () => {
  await removeTree(directory);
});

const tool = (name: string): McpTool => ({
  server: "s",
  name,
  inputSchema: { type: "object" },
});

void test("a stored list is a hit, an unknown key a miss", async () => {
  const index = new McpToolIndex({ cacheDirectory: join(directory, "a") });
  assert.equal(await index.get("k"), undefined);
  await index.set("k", [tool("one")]);
  assert.deepEqual(await index.get("k"), [tool("one")]);
  assert.equal(await index.get("other"), undefined);
});

void test("the index survives a new instance and leaves no temporary files", async () => {
  const cacheDirectory = join(directory, "b");
  await new McpToolIndex({ cacheDirectory }).set("k", [tool("one")]);
  assert.deepEqual(await new McpToolIndex({ cacheDirectory }).get("k"), [
    tool("one"),
  ]);
  assert.deepEqual(
    (await readdir(cacheDirectory)).filter((name) => !name.endsWith(".json")),
    [],
  );
});

void test("a corrupt file is a miss and a new set replaces it", async () => {
  const cacheDirectory = join(directory, "c");
  const writer = new McpToolIndex({ cacheDirectory });
  await writer.set("k", [tool("one")]);
  const [file] = await readdir(cacheDirectory);
  await writeFile(join(cacheDirectory, file), "{not json");
  const reader = new McpToolIndex({ cacheDirectory });
  assert.equal(await reader.get("k"), undefined);
  await reader.set("k", [tool("two")]);
  assert.deepEqual(await new McpToolIndex({ cacheDirectory }).get("k"), [
    tool("two"),
  ]);
});

void test("delete removes the entry from memory and disk", async () => {
  const cacheDirectory = join(directory, "d");
  const index = new McpToolIndex({ cacheDirectory });
  await index.set("k", [tool("one")]);
  await index.delete("k");
  await index.delete("never-set");
  assert.equal(await index.get("k"), undefined);
  assert.equal(await new McpToolIndex({ cacheDirectory }).get("k"), undefined);
});
