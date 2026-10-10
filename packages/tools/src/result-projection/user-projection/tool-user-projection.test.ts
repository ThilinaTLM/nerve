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
    "task_logs",
    {},
    { content: JSON.stringify({ bashId: "bash_1", output: text }) },
  );
  assert.deepEqual(logs.resultPreview, {
    bashId: "bash_1",
    output: "4\n5\n6\n7\n8\n9",
  });
});

void test("async bash previews retain the core working directory and start time", () => {
  const row = {
    id: "bash_1",
    status: "running",
    command: "echo",
    workingDirectory: "/project",
    startedAt: "2026-10-10T00:00:00.000Z",
  };
  for (const name of ["task_start", "task_status", "task_control"]) {
    const value =
      name === "task_start"
        ? { asyncBash: row }
        : name === "task_status"
          ? [row]
          : row;
    const preview = buildUserProjection(
      name,
      {},
      { content: JSON.stringify(value) },
    ).resultPreview;
    const summary =
      name === "task_start"
        ? (preview as { asyncBash: unknown }).asyncBash
        : name === "task_status"
          ? (preview as unknown[])[0]
          : preview;
    assert.deepEqual(summary, {
      id: row.id,
      status: row.status,
      command: row.command,
      cwd: row.workingDirectory,
      startedAt: row.startedAt,
    });
  }
});
