import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import {
  ProjectMigrationService,
  type ProjectConfigurationType,
} from "./project-migration.js";

const schema = z.object({ version: z.literal(2), value: z.string() });
const type: ProjectConfigurationType<z.infer<typeof schema>> = {
  id: "example",
  label: "Example configuration",
  resetDescription: "The example configuration will be reset.",
  path: "example.json",
  currentVersion: 2,
  version: { field: "version", absent: 1 },
  schema,
  fallback: () => ({ version: 2, value: "fallback" }),
  reset: () => ({ version: 2, value: "" }),
  migrators: { 1: (value) => ({ ...(value as object), version: 2 }) },
};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "project-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectId: "proj_test", directory: join(root, "project") };
  const home = join(root, "home");
  const path = join(context.directory, ".nerve", type.path);
  await mkdir(dirname(path), { recursive: true });
  const changes: unknown[] = [];
  const service = new ProjectMigrationService({
    home,
    changed: (health) => {
      changes.push(health);
    },
  });
  return { root, home, path, context, service, changes };
}
async function originals(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory())
      result.push(...(await originals(join(path, entry.name))));
    else if (entry.name.endsWith(".original"))
      result.push(await readFile(join(path, entry.name), "utf8"));
  }
  return result;
}
for (const [name, raw, classification] of [
  ["current", '{"version":2,"value":"ok"}', "healthy"],
  ["older", '{"version":1,"value":"ok"}', "migrated"],
  ["missing version", '{"value":"ok"}', "migrated"],
  ["invalid current", '{"version":2,"value":5}', "corrupted"],
  ["invalid migration output", '{"version":1,"value":5}', "corrupted"],
  ["unparseable", "{", "corrupted"],
  ["unrecognisable", '{"version":"one"}', "corrupted"],
  ["newer", '{"version":3,"value":5}', "incompatible"],
] as const) {
  void test(`classifies ${name}`, async (t) => {
    const f = await fixture(t);
    await writeFile(f.path, raw);
    const result = await f.service.load(f.context, type);
    assert.equal(result.classification, classification);
    if (classification !== "migrated")
      assert.equal(await readFile(f.path, "utf8"), raw);
    else {
      assert.deepEqual(await originals(f.home), [raw]);
      assert.deepEqual(JSON.parse(await readFile(f.path, "utf8")), {
        version: 2,
        value: "ok",
      });
      assert.deepEqual(await readdir(dirname(f.path)), ["example.json"]);
    }
    assert.equal(
      f.service.health(f.context.projectId).issues[0]?.resetOffered,
      classification === "healthy" ? undefined : classification === "corrupted",
    );
  });
}
void test("failed migrator preserves original and offers reset", async (t) => {
  const f = await fixture(t);
  const raw = '{"version":1,"value":"ok"}';
  await writeFile(f.path, raw);
  const result = await f.service.load(f.context, {
    ...type,
    migrators: {
      1: () => {
        throw new Error("no conversion");
      },
    },
  });
  assert.equal(result.classification, "corrupted");
  assert.equal(await readFile(f.path, "utf8"), raw);
});
void test("version field and absent default are per type", async (t) => {
  const f = await fixture(t);
  await writeFile(f.path, '{"value":"ok"}');
  const result = await f.service.load(f.context, {
    ...type,
    currentVersion: 1,
    version: { field: "schemaVersion", absent: 1 },
    schema: z.object({
      schemaVersion: z.literal(1),
      value: z.string(),
    }) as unknown as typeof schema,
  });
  assert.equal(result.classification, "healthy");
});
void test("concurrent edit abandons migration and reloads without overwriting", async (t) => {
  const f = await fixture(t);
  await writeFile(f.path, '{"version":1,"value":"old"}');
  let carried = false;
  const service = new ProjectMigrationService({
    home: f.home,
    trust: {
      capture: async () => {
        await writeFile(f.path, '{"version":2,"value":"manual edit"}');
        return async () => {
          carried = true;
        };
      },
    },
  });
  const result = await service.load(f.context, type);
  assert.equal(result.value.value, "manual edit");
  assert.equal(carried, false);
});
void test("migration carries only captured trust; reset never captures trust", async (t) => {
  const f = await fixture(t);
  const calls: string[] = [];
  const service = new ProjectMigrationService({
    home: f.home,
    trust: {
      capture: async ({ source }) => {
        calls.push(source.toString());
        return async (_path, bytes) => {
          calls.push(bytes.toString());
        };
      },
    },
  });
  await writeFile(f.path, '{"version":1,"value":"trusted"}');
  assert.equal(
    (await service.load(f.context, type)).classification,
    "migrated",
  );
  assert.equal(calls.length, 2);
  await writeFile(f.path, "invalid");
  await assert.rejects(service.reset(f.context, type, false), /confirmation/);
  assert.equal(await readFile(f.path, "utf8"), "invalid");
  assert.equal(
    (await service.reset(f.context, type, true)).classification,
    "healthy",
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    (await originals(f.home)).sort(),
    ["invalid", '{"version":1,"value":"trusted"}'].sort(),
  );
  await writeFile(f.path, '{"version":9}');
  await assert.rejects(service.reset(f.context, type, true), /Only corrupted/);
});
void test("atomic writer failure leaves the original unchanged and preserved", async (t) => {
  const f = await fixture(t);
  const raw = '{"version":1,"value":"original"}';
  await writeFile(f.path, raw);
  const service = new ProjectMigrationService({
    home: f.home,
    write: async () => {
      throw new Error("disk full");
    },
  });
  assert.equal(
    (await service.load(f.context, type)).classification,
    "corrupted",
  );
  assert.equal(await readFile(f.path, "utf8"), raw);
  assert.deepEqual(await originals(f.home), [raw]);
});
void test("reload clears a manually fixed issue and removal reset removes an override", async (t) => {
  const f = await fixture(t);
  await writeFile(f.path, "bad");
  await f.service.load(f.context, type);
  assert.equal(f.service.health(f.context.projectId).issues.length, 1);
  await writeFile(f.path, '{"version":2,"value":"fixed"}');
  await f.service.reload(f.context, type);
  assert.equal(f.service.health(f.context.projectId).issues.length, 0);
  await writeFile(f.path, "bad again");
  await f.service.reset(f.context, { ...type, reset: () => null }, true);
  await assert.rejects(readFile(f.path), { code: "ENOENT" });
});

void test("legacy newer version is read-only and never passed to conversion", async (t) => {
  const f = await fixture(t);
  const legacy = join(f.context.directory, ".nerve", "old.json");
  await writeFile(legacy, '{"schemaVersion":8}');
  let converted = false;
  const descriptor = {
    ...type,
    legacySources: [
      {
        path: "old.json",
        currentVersion: 1,
        version: { field: "schemaVersion", absent: 1 },
        migrate: () => {
          converted = true;
          return {};
        },
      },
    ],
  };
  const result = await f.service.load(f.context, descriptor);
  assert.equal(result.classification, "incompatible");
  assert.equal(converted, false);
  await assert.rejects(
    f.service.reset(f.context, descriptor, true),
    /Only corrupted/,
  );
  await assert.rejects(readFile(f.path), { code: "ENOENT" });
});

void test("registered resolve actions reload and confirm reset, without granting trust", async (t) => {
  const f = await fixture(t);
  f.service.register(type);
  await writeFile(f.path, "invalid");
  const failed = await f.service.resolve(f.context, {
    type: type.id,
    action: "reload",
  });
  assert.equal(failed.issues[0]?.classification, "corrupted");
  const reset = await f.service.resolve(f.context, {
    type: type.id,
    action: "reset",
    confirmed: true,
  });
  assert.deepEqual(reset.issues, []);
  await assert.rejects(
    f.service.resolve(f.context, { type: "unknown", action: "reload" }),
    /Unknown/,
  );
});

void test("feature transactions never overwrite corrupted or incompatible originals", async (t) => {
  const f = await fixture(t);
  for (const raw of ["corrupted", '{"version":99,"value":"newer"}']) {
    await writeFile(f.path, raw);
    let called = false;
    await assert.rejects(
      f.service.transact(f.context, type, (value) => {
        called = true;
        value.value = "overwrite";
        return { result: null, changed: true };
      }),
      /saving cannot overwrite the original/,
    );
    assert.equal(called, false);
    assert.equal(await readFile(f.path, "utf8"), raw);
    const issue = f.service.health(f.context.projectId).issues[0];
    assert.equal(issue.label, type.label);
    assert.equal(issue.resetDescription, type.resetDescription);
    assert.ok(issue.path.startsWith("/"));
  }
  await writeFile(f.path, '{"version":2,"value":"before"}');
  assert.equal(
    await f.service.transact(f.context, type, (value) => {
      value.value = "after";
      return { result: "saved", changed: true };
    }),
    "saved",
  );
  assert.equal(JSON.parse(await readFile(f.path, "utf8")).value, "after");
});

void test("transactions preserve concurrent invalid edits and issues expose absolute paths", async (t) => {
  const { writeFileSync } = await import("node:fs");
  const { isAbsolute, relative } = await import("node:path");
  const f = await fixture(t);
  const context = {
    ...f.context,
    directory: relative(process.cwd(), f.context.directory),
  };
  await writeFile(f.path, '{"version":2,"value":"before"}');
  await assert.rejects(
    f.service.transact(context, type, (value) => {
      value.value = "candidate";
      writeFileSync(f.path, "invalid external edit");
      return { result: null, changed: true };
    }),
    /changed during editing/,
  );
  assert.equal(await readFile(f.path, "utf8"), "invalid external edit");
  await f.service.load(context, type);
  assert.ok(isAbsolute(f.service.health(context.projectId).issues[0].path));
});

void test("a healthy current file clears and publishes a legacy-path issue", async (t) => {
  const f = await fixture(t);
  const descriptor = {
    ...type,
    legacySources: [
      {
        path: "old.json",
        currentVersion: 1,
        migrate: (value: unknown) => value,
      },
    ],
  };
  await writeFile(
    join(f.context.directory, ".nerve", "old.json"),
    "invalid legacy",
  );
  await f.service.load(f.context, descriptor);
  const count = f.changes.length;
  await writeFile(f.path, '{"version":2,"value":"fixed"}');
  await f.service.load(f.context, descriptor);
  assert.equal(f.changes.length, count + 1);
  assert.deepEqual(f.service.health(f.context.projectId).issues, []);
});
