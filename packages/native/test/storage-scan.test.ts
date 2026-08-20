import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CanonicalToolCallScanner } from "../src/index.js";

describe("canonical tool-call scanner", () => {
  it("returns deterministic byte-bounded batches", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-native-storage-"));
    try {
      const directory = join(home, "conversations", "conv_test", "tool-calls");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "tool_b.json"), '{"id":"tool_b"}');
      await writeFile(join(directory, "tool_a.json"), '{"id":"tool_a"}');
      const scanner = new CanonicalToolCallScanner(home);
      const first = await scanner.nextBatch(1, 1024);
      assert.equal(first.files.length, 1);
      assert.equal(first.files[0]?.toolCallId, "tool_a");
      assert.equal(first.done, false);
      const second = await scanner.nextBatch(10, 1024);
      assert.equal(second.files[0]?.toolCallId, "tool_b");
      assert.equal(second.done, true);
      assert.equal(second.files[0]?.bytes.toString("utf8"), '{"id":"tool_b"}');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
