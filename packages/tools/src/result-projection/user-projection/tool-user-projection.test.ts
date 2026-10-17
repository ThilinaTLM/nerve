import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUserProjection } from "./tool-user-projection.js";

void test("previews retain six useful lines, image references and core async bash output", () => {
  const text = Array.from({ length: 10 }, (_, i) => String(i)).join("\n");
  const bash = buildUserProjection(
    "bash",
    { command: "echo" },
    { content: text },
  );
  assert.equal(
    (bash.resultPreview as { content: string }).content,
    "4\n5\n6\n7\n8\n9",
  );
  assert.equal(bash.previewOverflow?.hidden, 4);
  assert.equal(bash.previewOverflow?.direction, "tail");
  assert.ok(
    !JSON.stringify(
      buildUserProjection("bash", { api_key: "secret" }, {}),
    ).includes("secret"),
  );
  const image = buildUserProjection(
    "read",
    { path: "image.png" },
    {
      contentBlocks: [
        { type: "image", assetId: "asset_image", mimeType: "image/png" },
      ],
    },
  );
  assert.ok(JSON.stringify(image).includes("asset_image"));
  const logs = buildUserProjection(
    "async_bash",
    { action: "logs", id: "bash_1" },
    { content: text },
  );
  assert.deepEqual(logs.resultPreview, { content: "4\n5\n6\n7\n8\n9" });
});

void test("durable previews retain lifecycle details and totals while bounding visible lists", () => {
  for (const [tool, list, total] of [
    ["find", "entries", "totalEntries"],
    ["ls", "entries", "totalEntries"],
    ["grep", "matches", "totalMatches"],
  ] as const) {
    const preview = buildUserProjection(
      tool,
      {},
      {
        [list]: Array.from({ length: 100 }, (_, index) => ({
          path: `file-${index}`,
          line: index,
          text: "match",
        })),
        details: { [total]: 100, totalFiles: 10 },
      },
    ).resultPreview as Record<string, unknown>;
    assert.equal((preview.details as Record<string, unknown>)[total], 100);
    assert.equal((preview[list] as unknown[]).length, 6);
  }
  const edit = buildUserProjection(
    "edit",
    {},
    {
      content: "done",
      details: {
        appliedCount: 0,
        operationCount: 2,
        operations: [
          { index: 0, status: "not_applied" },
          { index: 1, status: "failed", error: "not found" },
        ],
        diff: "diff",
      },
    },
  ).resultPreview as { details: Record<string, unknown> };
  assert.equal(edit.details.appliedCount, 0);
  assert.deepEqual(edit.details.operations, [
    { index: 0, status: "not_applied" },
    { index: 1, status: "failed", error: "not found" },
  ]);
  const image = buildUserProjection(
    "generate_image",
    { prompt: "draw" },
    {
      details: {
        images: [{ path: "/tmp/a.png", bytes: 123, width: 2, height: 3 }],
      },
    },
  ).resultPreview as { details: { images: unknown[] } };
  assert.deepEqual(image.details.images, [
    { path: "/tmp/a.png", bytes: 123, width: 2, height: 3 },
  ]);
});
