import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import type { ManagerState } from "../src/app/manager-state.js";
import { HttpError } from "../src/http/errors.js";
import { getSandboxWorkspaceFile } from "../src/routes/sandbox-workspace-file-routes.js";

function recordWithWorkspace(
  workspaceSource: string | undefined,
): ManagedSandboxRecord {
  const now = new Date().toISOString();
  return {
    sandboxId: "sbx_test",
    instanceId: "inst_test",
    backend: "docker",
    image: { reference: "nerve-sandbox-agent:dev" },
    desiredState: "created",
    observedState: "unknown",
    lifecycleState: "record_created",
    lifecycleUpdatedAt: now,
    workspaceRef: {
      kind: "local",
      source: workspaceSource,
      target: "/workspace",
    },
    stateRef: { kind: "local", target: "/state" },
    createdAt: now,
    updatedAt: now,
  };
}

function stateWith(record: ManagedSandboxRecord): ManagerState {
  return {
    sandboxes: {
      get: async (sandboxId: string) =>
        sandboxId === record.sandboxId ? record : undefined,
    },
  } as unknown as ManagerState;
}

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-sbx-file-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function assertRejectsHttp(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(
    fn,
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === status &&
      error.code === code,
  );
}

describe("getSandboxWorkspaceFile", () => {
  it("reads text files using relative workspace paths", async () => {
    await withWorkspace(async (dir) => {
      await mkdir(path.join(dir, "src"), { recursive: true });
      await writeFile(path.join(dir, "src", "app.ts"), "console.log('hi');\n");
      const result = await getSandboxWorkspaceFile(
        stateWith(recordWithWorkspace(dir)),
        "sbx_test",
        { path: "src/app.ts" },
      );
      assert.equal(result.sandboxId, "sbx_test");
      assert.equal(result.path, "/workspace/src/app.ts");
      assert.equal(result.relativePath, "src/app.ts");
      assert.equal(result.name, "app.ts");
      assert.equal(result.type, "text");
      assert.equal(result.binary, false);
      assert.equal(result.text, "console.log('hi');\n");
      assert.equal(result.lineStart, 1);
      assert.equal(result.truncated, false);
    });
  });

  it("reads text files using sandbox-visible /workspace paths", async () => {
    await withWorkspace(async (dir) => {
      await writeFile(path.join(dir, "README.md"), "# Hello\n");
      const result = await getSandboxWorkspaceFile(
        stateWith(recordWithWorkspace(dir)),
        "sbx_test",
        { path: "/workspace/README.md" },
      );
      assert.equal(result.path, "/workspace/README.md");
      assert.equal(result.relativePath, "README.md");
      assert.equal(result.type, "text");
      assert.equal(result.text, "# Hello\n");
    });
  });

  it("loads a line window for large text files", async () => {
    await withWorkspace(async (dir) => {
      const targetLine = 600;
      const lines = Array.from(
        { length: 1150 },
        (_, index) => `line ${index + 1} ${"x".repeat(1200)}`,
      );
      await writeFile(path.join(dir, "large.txt"), lines.join("\n"));
      const result = await getSandboxWorkspaceFile(
        stateWith(recordWithWorkspace(dir)),
        "sbx_test",
        { path: "large.txt", line: targetLine },
      );
      assert.equal(result.type, "text");
      assert.equal(result.truncated, true);
      assert.equal(result.targetLine, targetLine);
      assert.equal(result.lineStart, 400);
      assert.match(result.text ?? "", /line 600 /);
      assert.doesNotMatch(result.text ?? "", /line 1 /);
    });
  });

  it("reads image metadata and base64 data", async () => {
    await withWorkspace(async (dir) => {
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
      await writeFile(
        path.join(dir, "pixel.png"),
        Buffer.from(pngBase64, "base64"),
      );
      const result = await getSandboxWorkspaceFile(
        stateWith(recordWithWorkspace(dir)),
        "sbx_test",
        { path: "pixel.png" },
      );
      assert.equal(result.type, "image");
      assert.equal(result.binary, false);
      assert.equal(result.mimeType, "image/png");
      assert.equal(result.dataBase64, pngBase64);
      assert.equal(result.truncated, false);
    });
  });

  it("rejects traversal outside the workspace root", async () => {
    await withWorkspace(async (dir) => {
      await assertRejectsHttp(
        () =>
          getSandboxWorkspaceFile(
            stateWith(recordWithWorkspace(dir)),
            "sbx_test",
            {
              path: "../secret.txt",
            },
          ),
        403,
        "FORBIDDEN",
      );
    });
  });

  it("rejects absolute paths outside the sandbox workspace target", async () => {
    await withWorkspace(async (dir) => {
      await assertRejectsHttp(
        () =>
          getSandboxWorkspaceFile(
            stateWith(recordWithWorkspace(dir)),
            "sbx_test",
            {
              path: "/etc/passwd",
            },
          ),
        403,
        "FORBIDDEN",
      );
    });
  });

  it("rejects directories", async () => {
    await withWorkspace(async (dir) => {
      await mkdir(path.join(dir, "nested"));
      await assertRejectsHttp(
        () =>
          getSandboxWorkspaceFile(
            stateWith(recordWithWorkspace(dir)),
            "sbx_test",
            {
              path: "nested",
            },
          ),
        400,
        "VALIDATION_FAILED",
      );
    });
  });

  it("reports unavailable previews for non-local workspace refs", async () => {
    await assertRejectsHttp(
      () =>
        getSandboxWorkspaceFile(
          stateWith(recordWithWorkspace(undefined)),
          "sbx_test",
          { path: "README.md" },
        ),
      409,
      "INVALID_STATE",
    );
  });
});
