import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ProjectMigrationService,
  type ProjectConfigurationType,
} from "./project-migration.js";
import { projectMigrationTrust } from "./project-migration-trust.js";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { TrustedResource } from "@nervekit/contracts/core";
import { createHash } from "node:crypto";
const digest = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
void test("composite input conflicts reload all snapshots; future companions are incompatible and do not write", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "migration-inputs-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const context = { projectId: "p", directory: join(home, "project") };
  const root = join(context.directory, ".nerve");
  await mkdir(root, { recursive: true });
  const primary = join(root, "old.json"),
    companion = join(root, "part.json");
  await writeFile(primary, JSON.stringify({ version: 1 }));
  await writeFile(companion, JSON.stringify({ version: 1, value: "before" }));
  const type: ProjectConfigurationType<{ version: 1; value: string }> = {
    id: "combined",
    label: "Combined",
    resetDescription: "Remove override",
    path: "new.json",
    currentVersion: 1,
    version: { field: "version", absent: 1 },
    migrators: {},
    legacySources: [
      {
        path: "old.json",
        currentVersion: 1,
        inputs: [{ path: "part.json", currentVersion: 1 }],
        migrate: (_value, inputs) => inputs["part.json"],
      },
    ],
    schema: {
      parse(value) {
        const candidate = value as { version: 1; value: string };
        assert.equal(candidate.version, 1);
        assert.equal(typeof candidate.value, "string");
        return candidate;
      },
    },
    fallback: () => ({ version: 1, value: "fallback" }),
    reset: () => null,
  };
  let captured = false;
  const service = new ProjectMigrationService({
    home,
    trust: {
      async capture() {
        if (!captured) {
          captured = true;
          await writeFile(
            companion,
            JSON.stringify({ version: 1, value: "after" }),
          );
        }
        return undefined;
      },
    },
  });
  const loaded = await service.load(context, type);
  assert.equal(loaded.classification, "migrated");
  assert.equal(loaded.value.value, "after");
  await rm(join(root, "new.json"));
  await writeFile(companion, JSON.stringify({ version: 2, value: "future" }));
  assert.equal(
    (await service.load(context, type)).classification,
    "incompatible",
  );
  await assert.rejects(readFile(join(root, "new.json")), { code: "ENOENT" });
});
void test("trust derives multiple target approvals across kinds without consuming the shared source approval", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "migration-fanout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, "catalog.json"),
    a = join(root, "a.json"),
    b = join(root, "b.json");
  const source = Buffer.from("trusted catalog"),
    output = Buffer.from("profile");
  await writeFile(sourcePath, source);
  await writeFile(a, output);
  await writeFile(b, output);
  const original: TrustedResource = {
    id: "trust_source",
    kind: "agent_profile",
    projectId: "p",
    path: sourcePath,
    name: null,
    contentDigest: digest(source),
    status: "trusted",
    createdAt: "now",
    updatedAt: "now",
  };
  const records = new Map([[original.id, original]]);
  const storage = {
    transaction: (fn: () => void) => fn(),
    trustedResources: {
      find: (kind: string, project: string, path: string) => {
        const record = [...records.values()].find(
          (entry) =>
            entry.kind === kind &&
            entry.projectId === project &&
            entry.path === path,
        );
        return record ? { ...record } : null;
      },
      insert: (record: TrustedResource) => {
        records.set(record.id, record);
      },
      update: (id: string, patch: Partial<TrustedResource>) => {
        records.set(id, { ...records.get(id)!, ...patch });
      },
      delete: (id: string) => records.delete(id),
    },
  } as unknown as CoreStorage;
  const adapter = projectMigrationTrust(() => storage, {
    "agent-profile": "agent_profile",
  });
  const input = {
    type: "agent-profile:a",
    projectId: "p",
    path: sourcePath,
    source,
    targetKind: "project_capabilities" as const,
    sources: [{ path: sourcePath, source, kind: "agent_profile" as const }],
  };
  const first = await adapter.capture(input);
  assert.ok(first);
  await first(a, output);
  const second = await adapter.capture({ ...input, type: "agent-profile:b" });
  assert.ok(second);
  await second(b, output);
  assert.deepEqual(records.get(original.id), original);
  assert.equal(records.size, 3);
  assert.ok(
    [...records.values()]
      .filter((record) => record.path !== sourcePath)
      .every(
        (record) =>
          record.kind === "project_capabilities" &&
          record.contentDigest === digest(output).slice("sha256:".length),
      ),
  );
});

void test(
  "non-UTF8 project input is not silently repaired and escaping symlinks cannot overwrite external files",
  { skip: process.platform === "win32" },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "migration-paths-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const context = { projectId: "p", directory: join(home, "project") };
    const root = join(context.directory, ".nerve");
    await mkdir(root, { recursive: true });
    const type: ProjectConfigurationType<{ version: 1; value: string }> = {
      id: "safe",
      label: "Safe",
      resetDescription: "Remove override",
      path: "safe.json",
      currentVersion: 1,
      version: { field: "version", absent: 1 },
      migrators: {},
      schema: { parse: (value) => value as { version: 1; value: string } },
      fallback: () => ({ version: 1, value: "fallback" }),
      reset: () => null,
    };
    const service = new ProjectMigrationService({ home });
    const invalid = Buffer.concat([
      Buffer.from('{"version":1,"value":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
    await writeFile(join(root, "safe.json"), invalid);
    assert.equal(
      (await service.load(context, type)).classification,
      "corrupted",
    );
    assert.deepEqual(await readFile(join(root, "safe.json")), invalid);
    await rm(join(root, "safe.json"));
    const external = join(home, "external.json");
    await writeFile(external, '{"version":1,"value":"external"}');
    const { symlink } = await import("node:fs/promises");
    await symlink(external, join(root, "safe.json"));
    assert.equal(
      (await service.load(context, type)).classification,
      "corrupted",
    );
    assert.equal(service.health("p").issues[0].resetOffered, false);
    await assert.rejects(
      service.transact(context, type, () => ({
        result: null,
        changed: true,
        value: { version: 1, value: "replaced" },
      })),
    );
    assert.equal(
      await readFile(external, "utf8"),
      '{"version":1,"value":"external"}',
    );
  },
);
