import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TrustedResource } from "@nervekit/contracts/core";
import type { CoreStorage } from "@nervekit/conversation-core";
import { revokeTrust, trustedWrite } from "./trusted-write.js";

const digest = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

function setup(row?: Partial<TrustedResource>) {
  let record: TrustedResource | undefined = row
    ? ({
        id: "trust_1",
        kind: "agent_profile",
        projectId: null,
        name: null,
        grants: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        ...row,
      } as TrustedResource)
    : undefined;
  const storage = {
    transaction: (fn: () => void) => fn(),
    trustedResources: {
      find: (kind: string, projectId: string | null) =>
        record && record.kind === kind && record.projectId === projectId
          ? { ...record }
          : null,
      insert: (value: TrustedResource) => {
        record = value;
      },
      update: (_id: string, patch: Partial<TrustedResource>) => {
        record = { ...record!, ...patch };
      },
      delete: () => {
        record = undefined;
      },
    },
  } as unknown as CoreStorage;
  return { storage: () => storage, record: () => record };
}

async function file(text?: string) {
  const root = await mkdtemp(join(tmpdir(), "trusted-write-"));
  const path = join(root, "reviewer.json");
  if (text !== undefined) await writeFile(path, text);
  return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const write = (path: string, text: string) => async () => {
  await writeFile(path, text);
  return text;
};

void test("a user file Nerve rewrites stays trusted when its bytes were trusted", async () => {
  const f = await file("old");
  const s = setup({
    resourceKey: f.path,
    contentDigest: digest("old"),
    status: "trusted",
  });
  await trustedWrite(
    s.storage,
    { kind: "agent_profile", projectId: null, path: f.path },
    write(f.path, "new"),
  );
  assert.equal(s.record()?.contentDigest, digest("new"));
  assert.equal(s.record()?.status, "trusted");
  await f.cleanup();
});

void test("a user file that waits, was declined or changed outside Nerve keeps its state", async () => {
  for (const row of [
    { status: "trusted" as const, contentDigest: digest("other") },
    { status: "rejected" as const, contentDigest: digest("old") },
    undefined,
  ]) {
    const f = await file("old");
    const s = setup(row && { ...row, resourceKey: f.path });
    const before = s.record();
    await trustedWrite(
      s.storage,
      { kind: "agent_profile", projectId: null, path: f.path },
      write(f.path, "new"),
    );
    assert.deepEqual(s.record(), before);
    await f.cleanup();
  }
});

void test("a user file Nerve creates is trusted, unless a decision about the path exists", async () => {
  const created = await file();
  const fresh = setup();
  await trustedWrite(
    fresh.storage,
    { kind: "agent_profile", projectId: null, path: created.path },
    write(created.path, "new"),
  );
  assert.equal(fresh.record()?.contentDigest, digest("new"));
  assert.equal(fresh.record()?.projectId, null);
  assert.equal(await readFile(created.path, "utf8"), "new");
  const declined = setup({
    resourceKey: created.path,
    contentDigest: digest("x"),
    status: "rejected",
  });
  await trustedWrite(
    declined.storage,
    { kind: "agent_profile", projectId: null, path: created.path },
    write(created.path, "newer"),
  );
  assert.equal(declined.record()?.status, "rejected");
  await created.cleanup();
});

void test("removing a file through Nerve forgets its decision", async () => {
  const s = setup({
    resourceKey: "/x",
    contentDigest: digest("old"),
    status: "trusted",
  });
  revokeTrust(s.storage, {
    kind: "agent_profile",
    projectId: null,
    paths: ["/x"],
  });
  assert.equal(s.record(), undefined);
});
