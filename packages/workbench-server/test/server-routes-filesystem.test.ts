import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

describe("orchestrator server filesystem routes", () => {
  it("returns directory listings with shallow project signals and hidden filtering", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const root = await tempHome("nerve-fs-routes-");
      const jsProject = join(root, "js-app");
      const pyProject = join(root, "py-tool");
      const hiddenProject = join(root, ".hidden-app");
      await mkdir(join(jsProject, ".git"), { recursive: true });
      await mkdir(pyProject, { recursive: true });
      await mkdir(hiddenProject, { recursive: true });
      await writeFile(join(jsProject, "package.json"), "{}\n");
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
      await writeFile(
        join(pyProject, "pyproject.toml"),
        '[project]\nname = "py-tool"\n',
      );

      const response = await app.request(
        `/api/filesystem/directories?path=${encodeURIComponent(root)}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        path: string;
        signals: string[];
        entries: Array<{ name: string; signals: string[] }>;
      };
      assert.equal(body.path, root);
      assert.ok(body.signals.includes("workspace"));
      assert.equal(
        body.entries.some((entry) => entry.name === ".hidden-app"),
        false,
      );
      assert.deepEqual(
        body.entries.find((entry) => entry.name === "js-app")?.signals,
        ["git", "package"],
      );
      assert.deepEqual(
        body.entries.find((entry) => entry.name === "py-tool")?.signals,
        ["python"],
      );

      const withHidden = await app.request(
        `/api/filesystem/directories?path=${encodeURIComponent(root)}&showHidden=true`,
        { headers },
      );
      assert.equal(withHidden.status, 200);
      assert.ok(
        (
          (await withHidden.json()) as { entries: Array<{ name: string }> }
        ).entries.some((entry) => entry.name === ".hidden-app"),
      );
    } finally {
      state.index.close();
    }
  });

  it("previews files outside the selected project from absolute paths", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-fs-project-");
      const outsideRoot = await tempHome("nerve-fs-outside-");
      const insidePath = join(projectRoot, "inside.txt");
      const outsidePath = join(outsideRoot, "outside.txt");
      await writeFile(insidePath, "inside file\n");
      await writeFile(outsidePath, "outside file\n");
      const project = await state.registry.createProject({ dir: projectRoot });

      const outsideResponse = await app.request(
        `/api/filesystem/file?projectId=${encodeURIComponent(project.id)}&path=${encodeURIComponent(outsidePath)}`,
        { headers },
      );
      assert.equal(outsideResponse.status, 200);
      const outsideBody = (await outsideResponse.json()) as {
        path: string;
        relativePath: string;
        type: string;
        text?: string;
      };
      assert.equal(outsideBody.path, outsidePath);
      assert.equal(outsideBody.relativePath, outsidePath);
      assert.equal(outsideBody.type, "text");
      assert.equal(outsideBody.text, "outside file\n");

      const insideResponse = await app.request(
        `/api/filesystem/file?projectId=${encodeURIComponent(project.id)}&path=inside.txt`,
        { headers },
      );
      assert.equal(insideResponse.status, 200);
      const insideBody = (await insideResponse.json()) as {
        path: string;
        relativePath: string;
        text?: string;
      };
      assert.equal(insideBody.path, insidePath);
      assert.equal(insideBody.relativePath, "inside.txt");
      assert.equal(insideBody.text, "inside file\n");
    } finally {
      state.index.close();
    }
  });

  it("returns a line-aware preview window for large text files", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-fs-large-project-");
      const filePath = join(projectRoot, "large.txt");
      const targetLine = 12_000;
      const lines = Array.from({ length: 15_000 }, (_, index) => {
        const line = index + 1;
        const marker = line === targetLine ? " TARGET-LINE" : "";
        return `line ${line.toString().padStart(5, "0")}${marker} ${"x".repeat(90)}`;
      });
      await writeFile(filePath, `${lines.join("\n")}\n`);
      const project = await state.registry.createProject({ dir: projectRoot });

      const response = await app.request(
        `/api/filesystem/file?projectId=${encodeURIComponent(project.id)}&path=large.txt&line=${targetLine}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        lineStart?: number;
        targetLine?: number;
        text?: string;
        truncated: boolean;
      };
      assert.equal(body.truncated, true);
      assert.equal(body.targetLine, targetLine);
      assert.ok((body.lineStart ?? 0) > 1);
      assert.ok((body.lineStart ?? Number.MAX_SAFE_INTEGER) <= targetLine);
      assert.match(body.text ?? "", /line 12000 TARGET-LINE/);
      assert.doesNotMatch(body.text ?? "", /line 00001/);
    } finally {
      state.index.close();
    }
  });

  it("saves pasted clipboard images to the temp nerve directory", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    let filePath: string | undefined;
    try {
      const response = await app.request("/api/filesystem/clipboard-image", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Screenshot 2026-06-03.png",
          type: "image/png",
          dataBase64: Buffer.from([1, 2, 3]).toString("base64"),
        }),
      });
      assert.equal(response.status, 200);

      const body = (await response.json()) as { path: string };
      filePath = body.path;
      assert.ok(body.path.startsWith(`${join(tmpdir(), "nerve")}/`));
      assert.match(body.path, /\/screenshot-2026-06-03-\d{8}T\d{6}Z\.png$/);
      assert.deepEqual(Array.from(await readFile(body.path)), [1, 2, 3]);
    } finally {
      if (filePath) await rm(filePath, { force: true });
      state.index.close();
    }
  });
});
