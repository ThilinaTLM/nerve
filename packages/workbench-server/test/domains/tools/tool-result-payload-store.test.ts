import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  ToolResultPayloadCorruptError,
  ToolResultPayloadStore,
} from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

async function store() {
  const home = await mkdtemp(join(tmpdir(), "nerve-payload-store-"));
  roots.push(home);
  return { home, payloads: new ToolResultPayloadStore(home) };
}

describe("ToolResultPayloadStore", () => {
  it("writes deterministic private JSON and verifies complete reads", async () => {
    const { home, payloads } = await store();
    const reference = await payloads.write("conv_test", "tool_test", {
      z: "last",
      a: "first",
    });
    assert.equal(reference.completeness, "complete");
    assert.deepEqual(await payloads.read(reference), {
      a: "first",
      z: "last",
    });
    const path = join(
      home,
      "data",
      "payloads",
      "conversations",
      "conv_test",
      "tool-calls",
      "tool_test",
      "result.json",
    );
    assert.match(await readFile(path, "utf8"), /^\{\n {2}"a": "first"/);
  });

  it("reads UTF-8-safe bounded ranges", async () => {
    const { payloads } = await store();
    const reference = await payloads.write(
      "conv_test",
      "tool_range",
      "🙂 alpha\n🙂 beta",
    );
    const chunks: string[] = [];
    let offset = 0;
    while (offset < reference.byteLength) {
      const chunk = await payloads.readTextRange(reference, offset, 7);
      assert.ok(chunk.nextByteOffset > offset);
      chunks.push(chunk.text);
      offset = chunk.nextByteOffset;
    }
    assert.equal(chunks.join(""), '"🙂 alpha\\n🙂 beta"\n');
  });

  it("rejects owner traversal and detects modified bytes", async () => {
    const { payloads } = await store();
    await assert.rejects(
      payloads.write("conv_../escape", "tool_test", "no"),
      ToolResultPayloadCorruptError,
    );
    const reference = await payloads.write(
      "conv_test",
      "tool_test",
      "original",
    );
    await writeFile(payloads.path(reference), '"modified"\n');
    await assert.rejects(
      payloads.read(reference),
      ToolResultPayloadCorruptError,
    );
  });

  it("rejects symlinked payload directory chains", async () => {
    const { home, payloads } = await store();
    await payloads.initialize();
    const target = join(home, "escape");
    await mkdir(target);
    await symlink(target, join(home, "data", "payloads", "conversations"));
    await assert.rejects(
      payloads.write("conv_test", "tool_test", "no escape"),
      ToolResultPayloadCorruptError,
    );
  });

  it("removes only old unreferenced recognized files", async () => {
    const { payloads } = await store();
    const kept = await payloads.write("conv_test", "tool_keep", "keep");
    const orphan = await payloads.write("conv_test", "tool_orphan", "orphan");
    const result = await payloads.reconcile(
      new Set([payloads.path(kept)]),
      Date.now() + 25 * 60 * 60 * 1000,
    );
    assert.equal(result.removed, 1);
    assert.equal(await payloads.read(kept), "keep");
    await assert.rejects(payloads.read(orphan));
  });
});
