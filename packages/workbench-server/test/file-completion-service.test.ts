import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { candidateFromPath } from "../src/domains/completions/file-completion-candidates.js";
import { FileCompletionService } from "../src/domains/completions/file-completion-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function projectFixture(): Promise<ProjectRecord> {
  const dir = await mkdtemp(join(tmpdir(), "nerve-file-service-"));
  roots.push(dir);
  await writeFile(join(dir, "README.md"), "");
  return {
    id: "proj_completion_test",
    name: "Completion test",
    dir,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("FileCompletionService", () => {
  it("coalesces concurrent initial discovery", async () => {
    const project = await projectFixture();
    const discovery = deferred<ReturnType<typeof candidateFromPath>[]>();
    let calls = 0;
    const service = new FileCompletionService(() => project, {
      discover: async () => {
        calls += 1;
        return discovery.promise;
      },
    });

    const first = service.completeFiles(project.id, "read");
    const second = service.completeFiles(project.id, "read");
    assert.equal(calls, 1);
    discovery.resolve([candidateFromPath("README.md", "file")]);

    assert.equal((await first)[0]?.info, "README.md");
    assert.equal((await second)[0]?.info, "README.md");
    assert.equal(calls, 1);
  });

  it("prewarms from direct listings and serves stale data during one refresh", async () => {
    const project = await projectFixture();
    const refresh = deferred<ReturnType<typeof candidateFromPath>[]>();
    let now = 0;
    let calls = 0;
    const service = new FileCompletionService(() => project, {
      now: () => now,
      discover: async () => {
        calls += 1;
        if (calls === 1) return [candidateFromPath("README.md", "file")];
        return refresh.promise;
      },
    });

    await service.completeFiles(project.id, "");
    await flush();
    assert.equal(calls, 1);
    assert.equal(
      (await service.completeFiles(project.id, "read"))[0]?.info,
      "README.md",
    );

    now = 120_001;
    const stale = await service.completeFiles(project.id, "read");
    const alsoStale = await service.completeFiles(project.id, "read");
    assert.equal(stale[0]?.info, "README.md");
    assert.equal(alsoStale[0]?.info, "README.md");
    assert.equal(calls, 2);

    refresh.resolve([candidateFromPath("reader.ts", "file")]);
    await flush();
    assert.equal(
      (await service.completeFiles(project.id, "read"))[0]?.info,
      "reader.ts",
    );

    service.dispose(project.id);
    void service.completeFiles(project.id, "read");
    assert.equal(calls, 3);
  });

  it("retries after an initial discovery failure", async () => {
    const project = await projectFixture();
    let calls = 0;
    const service = new FileCompletionService(() => project, {
      discover: async () => {
        calls += 1;
        if (calls === 1) throw new Error("scan failed");
        return [candidateFromPath("README.md", "file")];
      },
    });

    await assert.rejects(
      service.completeFiles(project.id, "read"),
      /scan failed/,
    );
    assert.equal(
      (await service.completeFiles(project.id, "read"))[0]?.info,
      "README.md",
    );
    assert.equal(calls, 2);
  });
});
