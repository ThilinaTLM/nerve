import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it, mock } from "node:test";
import { executeExplainImage } from "../../src/execution/vision/explain-image.js";
import { executeWebSearch } from "../../src/execution/web/web-search.js";

const roots: string[] = [];
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function artifactFixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), `nerve-${name}-`));
  roots.push(root);
  return { root, artifactDir: join(root, "tool-call", "files") };
}

describe("owner-scoped artifact routing", () => {
  it("stores web-search recovery output in the supplied tool-call directory", async () => {
    const { root, artifactDir } = await artifactFixture("web-search-owner");
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            answer: "x".repeat(300_000),
            results: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const result = await executeWebSearch(
        { query: "owner routing" },
        {
          cwd: root,
          artifactDir,
          getApiKey: async () => "test-key",
        },
      );
      const path = (result.details as { fullOutputPath?: string })
        .fullOutputPath;
      assert.equal(path, join(artifactDir, "combined.txt"));
      assert.match(
        await readFile(path ?? "", "utf8"),
        /^\[stdout\]\n\*\*Answer:\*\*/,
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("stores image-explanation recovery output in the supplied tool-call directory", async () => {
    const { root, artifactDir } = await artifactFixture("vision-owner");
    const image = join(root, "image.png");
    await writeFile(
      image,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const result = await executeExplainImage(
      { path: image },
      {
        cwd: root,
        artifactDir,
        explainImage: async () => ({
          explanation: "vision ".repeat(50_000),
          model: { provider: "test", modelId: "vision-test" },
        }),
      },
    );
    const path = (result.details as { fullOutputPath?: string }).fullOutputPath;
    assert.equal(path, join(artifactDir, "combined.txt"));
    assert.match(
      await readFile(path ?? "", "utf8"),
      /^\[stdout\]\nvision vision/,
    );
  });
});
