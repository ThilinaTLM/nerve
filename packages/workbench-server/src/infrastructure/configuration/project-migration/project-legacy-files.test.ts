import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import { resolveProjectConfigurationSchema } from "@nervekit/contracts/projects";
import { digest } from "./project-migration-files.js";
import {
  ProjectMigrationService,
  type ProjectConfigurationType,
} from "./project-migration.js";

const type: ProjectConfigurationType<{ version: 1 }> = {
  id: "example",
  label: "Example",
  resetDescription: "Remove override",
  path: "config/current.json",
  currentVersion: 1,
  version: { field: "version", absent: 1 },
  migrators: {},
  legacyFiles: ["config/harness.json", "subagents/*.md"],
  schema: z.object({ version: z.literal(1) }),
  fallback: () => ({ version: 1 }),
  reset: () => null,
};
async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "legacy-notices-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const context = { projectId: "p", directory: join(home, "project") };
  const put = async (name: string, raw: string) => {
    const path = join(context.directory, ".nerve", name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, raw);
    return path;
  };
  const service = new ProjectMigrationService({ home });
  service.register(type);
  return { home, context, put, service };
}
async function originals(root: string): Promise<Buffer[]> {
  const files = await readdir(root, { recursive: true });
  return Promise.all(
    files
      .filter((name) => name.endsWith(".original"))
      .map((name) => readFile(join(root, name))),
  );
}
const remove = {
  type: "legacy-files",
  action: "remove-legacy",
  confirmed: true,
} as const;

void test("one aggregate notice lists known files without decoding or importing; confirmed removal is permanent", async (t) => {
  const f = await fixture(t);
  f.service.register({
    ...type,
    id: "launches",
    legacyFiles: ["tasks/definitions.json"],
  });
  const files = [
    await f.put("config/harness.json", "bad JSON"),
    await f.put("subagents/old.md", "---\nold"),
    await f.put("tasks/definitions.json", "older tasks"),
  ].sort();
  const current = await f.put(type.path, '{"version":1}');
  const unrelated = await f.put("subagents/notes.txt", "keep this");
  assert.equal(
    (await f.service.load(f.context, type)).classification,
    "healthy",
  );
  const [notice] = f.service.health("p").issues;
  assert.equal(notice.classification, "legacy");
  assert.equal(notice.resetOffered, false);
  assert.deepEqual(notice.files, files);
  assert.equal(f.service.health("p").issues.length, 1);
  assert.equal(
    resolveProjectConfigurationSchema.safeParse({ ...remove, confirmed: false })
      .success,
    false,
  );
  await assert.rejects(
    f.service.resolve(f.context, { ...remove, confirmed: false as true }),
    /confirmation/,
  );
  assert.equal(await readFile(files[0], "utf8"), "bad JSON");
  assert.deepEqual((await f.service.resolve(f.context, remove)).issues, []);
  for (const file of files)
    await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.equal(await readFile(current, "utf8"), '{"version":1}');
  assert.equal(await readFile(unrelated, "utf8"), "keep this");
  assert.deepEqual(
    (await originals(join(f.home, "quarantine")))
      .map((bytes) => bytes.toString())
      .sort(),
    ["bad JSON", "---\nold", "older tasks"].sort(),
  );
  const restarted = new ProjectMigrationService({ home: f.home });
  await restarted.load(f.context, type);
  assert.deepEqual(restarted.health("p").issues, []);
  assert.equal(
    (await readdir(f.home, { recursive: true })).some((name) =>
      name.endsWith(".reset.json"),
    ),
    false,
  );
  await f.put("config/harness.json", "new old file");
  await restarted.load(f.context, type);
  assert.equal(restarted.health("p").issues[0]?.classification, "legacy");
});

void test("legacy removal never resets or unprotects a corrupt current configuration", async (t) => {
  const f = await fixture(t);
  const current = await f.put(type.path, "broken current");
  await f.put("config/harness.json", "broken old");
  assert.equal(
    (await f.service.load(f.context, type)).classification,
    "corrupted",
  );
  assert.deepEqual(
    f.service
      .health("p")
      .issues.map((issue) => issue.classification)
      .sort(),
    ["corrupted", "legacy"],
  );
  await assert.rejects(
    f.service.resolve(f.context, {
      type: "legacy-files",
      action: "reset",
      confirmed: true,
    }),
    /cannot be reset/,
  );
  await f.service.resolve(f.context, remove);
  assert.equal(await readFile(current, "utf8"), "broken current");
  await assert.rejects(
    f.service.transact(f.context, type, () => ({
      changed: true,
      result: null,
    })),
    /saving cannot overwrite/,
  );
  assert.equal(f.service.health("p").issues[0]?.classification, "corrupted");
});

void test("a failed quarantine preserves every old file and the notice", async (t) => {
  const f = await fixture(t);
  const old = await f.put("config/harness.json", "original bytes");
  await f.service.load(f.context, type);
  const backup = join(
    f.home,
    "quarantine/project-configuration",
    digest("p"),
    digest(old),
    `${digest("original bytes")}.original`,
  );
  await mkdir(dirname(backup), { recursive: true });
  await writeFile(backup, "wrong bytes");
  await assert.rejects(
    f.service.resolve(f.context, remove),
    /Quarantine original differs/,
  );
  assert.equal(await readFile(old, "utf8"), "original bytes");
  assert.equal(f.service.health("p").issues[0]?.classification, "legacy");
});

void test(
  "legacy removal cannot follow an escaping file link",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    const old = await f.put("config/harness.json", "placeholder");
    const outside = join(f.home, "outside.json");
    await writeFile(outside, "outside bytes");
    await rm(old);
    await symlink(outside, old);
    assert.equal(
      (await f.service.load(f.context, type)).classification,
      "healthy",
    );
    await assert.rejects(f.service.resolve(f.context, remove), /escapes/);
    assert.equal(await readFile(outside, "utf8"), "outside bytes");
    assert.equal(f.service.health("p").issues[0]?.classification, "legacy");
  },
);

void test(
  "legacy directory aliases cannot remove active files elsewhere in the project",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    const active = await f.put("suggestions/current.md", "Active suggestion");
    await symlink(
      dirname(active),
      join(f.context.directory, ".nerve/subagents"),
      "dir",
    );
    await f.service.load(f.context, type);
    await assert.rejects(
      f.service.resolve(f.context, remove),
      /Remove legacy links manually/,
    );
    assert.equal(await readFile(active, "utf8"), "Active suggestion");
    assert.equal(f.service.health("p").issues[0]?.classification, "legacy");
  },
);
