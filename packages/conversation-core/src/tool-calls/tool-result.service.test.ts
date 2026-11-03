import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolCallSchema } from "@nervekit/contracts/core";
import { projectProcessOutputResult } from "@nervekit/tools/result-projection";
import type { AssetStore } from "../assets/asset-store.js";
import { prepareToolResult } from "./tool-result.service.js";

function call(toolName: string) {
  return toolCallSchema.parse({
    id: "tool_1",
    conversationId: "conv_1",
    turnId: "turn_1",
    providerCallId: "provider_1",
    assistantEventId: "event_1",
    contentIndex: 0,
    origin: "model",
    toolName,
    arguments: {},
    state: "running",
    supervision: null,
    executionClaim: null,
    updatedAt: "2026-11-03T00:00:00Z",
    interaction: null,
  });
}

const writes: Record<string, string> = {};

async function withAssets(run: (assets: AssetStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "nerve-tool-result-"));
  const assets = {
    path: (path: string) => join(root, path),
    async write(input: { content: string; logicalPath: string }) {
      writes[input.logicalPath] = input.content;
      return {
        id: "asset_payload",
        logicalPath: input.logicalPath,
        byteLength: Buffer.byteLength(input.content),
      };
    },
  } as unknown as AssetStore;
  try {
    await run(assets);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `row ${i} ${"x".repeat(60)}`).join(
    "\n",
  );

void test("producer-projected bash output records the producer's reduction", async () => {
  await withAssets(async (assets) => {
    const output = lines(1000);
    const projected = await projectProcessOutputResult({
      output,
      outputFiles: { combined: "/capture/output.txt" },
      status: "completed",
      exitCode: 0,
    });
    const prepared = await prepareToolResult(
      assets,
      call("bash"),
      "completed",
      {
        stdout: output,
        stderr: "",
        content: projected.text,
        details: {
          processStatusIncluded: true,
          agentProjectionSnapshot: projected.snapshot,
        },
      },
    );
    assert.deepEqual(prepared.agentProjection, [
      { type: "text", text: projected.text },
    ]);
    assert.equal(prepared.agentProjectionSnapshot.strategy, "head_tail");
    assert.ok(
      prepared.agentProjectionSnapshot.originalTextBytes >
        prepared.agentProjectionSnapshot.displayedTextBytes,
    );
  });
});

void test("results reduced by this pass record its own snapshot", async () => {
  await withAssets(async (assets) => {
    const prepared = await prepareToolResult(
      assets,
      call("python_exec"),
      "completed",
      { stdout: "", stderr: "", content: lines(1000), exitCode: 0 },
    );
    assert.equal(prepared.agentProjectionSnapshot.profile, "script_output");
    assert.equal(prepared.agentProjectionSnapshot.strategy, "head_tail");
    assert.equal(prepared.agentProjectionSnapshot.fastPath, false);
  });
});

void test("stored payloads keep text once unless content blocks add to it", async () => {
  await withAssets(async (assets) => {
    const text = "line 1\nline 2";
    await prepareToolResult(assets, call("read"), "completed", {
      content: text,
      contentBlocks: [{ type: "text", text }],
    });
    const stored = JSON.parse(
      writes["conversations/conv_1/tool-calls/tool_1/result.json"]!,
    );
    assert.equal(stored.content, text);
    assert.equal(stored.contentBlocks, undefined);

    await prepareToolResult(assets, call("read"), "completed", {
      content: "Read image file [image/png]",
      contentBlocks: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "text", text: "extra" },
      ],
    });
    const kept = JSON.parse(
      writes["conversations/conv_1/tool-calls/tool_1/result.json"]!,
    );
    assert.equal(kept.contentBlocks.length, 2);
  });
});
