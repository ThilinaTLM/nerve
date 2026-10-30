import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { TrustedResource } from "@nervekit/contracts/core";
import { projectMigrationTrust } from "./project-migration-trust.js";
const digest = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
void test("only exact trusted bytes carry over; changed bindings and reset cannot grant trust", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "migration-trust-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "old.json"),
    target = join(root, "new.json");
  const source = Buffer.from("old trusted bytes"),
    output = Buffer.from("new bytes");
  await writeFile(path, source);
  await writeFile(target, output);
  let record: TrustedResource | undefined = {
    id: "trust_one",
    kind: "project_permissions",
    projectId: "proj_one",
    path,
    name: "old.json",
    contentDigest: digest(source),
    status: "trusted",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  };
  const storage = {
    transaction: (fn: () => void) => fn(),
    trustedResources: {
      find: (_kind: string, _projectId: string, query: string) =>
        record?.path === query ? { ...record } : null,
      update: (_id: string, patch: Partial<TrustedResource>) => {
        record = { ...record!, ...patch };
      },
      delete: () => {
        record = undefined;
      },
    },
  } as unknown as CoreStorage;
  const trust = projectMigrationTrust(() => storage, {
    permissions: "project_permissions",
  });
  const input = { type: "permissions", projectId: "proj_one", path, source };
  assert.equal(
    await trust.capture({ ...input, source: Buffer.from("edited") }),
    undefined,
  );
  const revoked = (await trust.capture(input))!;
  record.status = "rejected";
  await revoked(target, output);
  assert.equal(record.contentDigest, digest(source));
  assert.equal(await trust.capture(input), undefined);
  record.status = "trusted";
  const carry = (await trust.capture(input))!;
  await writeFile(target, "external edit");
  await carry(target, output);
  assert.equal(record.path, path);
  await writeFile(target, output);
  await carry(target, await readFile(target));
  assert.equal(record.path, target);
  assert.equal(record.contentDigest, digest(output));
  await trust.revoke!({
    type: "permissions",
    projectId: "proj_one",
    paths: [path, target],
  });
  assert.equal(record, undefined);
});
