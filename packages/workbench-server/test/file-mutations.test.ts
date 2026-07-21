import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  atomicWriteFile,
  retryRename,
  withFileMutation,
} from "../src/infrastructure/storage/file-mutations.js";

function codedError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nerve-file-mutations-"));
}

describe("file mutations", () => {
  it("retries transient rename errors with bounded exponential delays", async () => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      let attempts = 0;
      const delays: number[] = [];
      const observed: Array<{ attempt: number; delayMs: number }> = [];
      await retryRename("source", "target", {
        rename: async () => {
          attempts += 1;
          if (attempts < 3) throw codedError(code);
        },
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
        onRenameRetry: (observation) => observed.push(observation),
      });
      assert.equal(attempts, 3);
      assert.deepEqual(delays, [10, 20]);
      assert.deepEqual(observed, [
        { attempt: 1, delayMs: 10 },
        { attempt: 2, delayMs: 20 },
      ]);
    }
  });

  it("does not retry non-transient rename errors", async () => {
    let attempts = 0;
    await assert.rejects(
      retryRename("source", "target", {
        rename: async () => {
          attempts += 1;
          throw codedError("EXDEV");
        },
        delay: async () => assert.fail("must not delay"),
      }),
      { code: "EXDEV" },
    );
    assert.equal(attempts, 1);
  });

  it("bounds transient retries", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await assert.rejects(
      retryRename("source", "target", {
        rename: async () => {
          attempts += 1;
          throw codedError("EPERM");
        },
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
      }),
      { code: "EPERM" },
    );
    assert.equal(attempts, 8);
    assert.deepEqual(delays, [10, 20, 40, 80, 160, 320, 640]);
  });

  it("cleans temporary files after failed and successful replacement", async () => {
    const root = await tempRoot();
    const target = join(root, "state.json");
    try {
      await assert.rejects(
        atomicWriteFile(target, "failed", {
          rename: async () => {
            throw codedError("EXDEV");
          },
          delay: async () => undefined,
        }),
        { code: "EXDEV" },
      );
      assert.deepEqual(await readdir(root), []);

      await atomicWriteFile(target, "ready");
      assert.equal(await readFile(target, "utf8"), "ready");
      assert.deepEqual(await readdir(root), ["state.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes mutations to the same normalized target", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withFileMutation("relative-state.json", async () => {
      order.push("first:start");
      await firstBlocked;
      order.push("first:end");
    });
    const second = withFileMutation(
      join(process.cwd(), "relative-state.json"),
      async () => {
        order.push("second");
      },
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
  });

  it("closes the temporary handle before rename", async () => {
    const root = await tempRoot();
    const target = join(root, "closed-before-rename.txt");
    try {
      await atomicWriteFile(target, "contents", {
        rename: async (source, destination) => {
          assert.equal(await readFile(source, "utf8"), "contents");
          await rename(source, destination);
        },
      });
      assert.equal(await readFile(target, "utf8"), "contents");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
