import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
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
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import {
  createLaunchDefinitionRequestSchema,
  launchDefinitionFileSchema,
} from "@nervekit/contracts/launch-definitions";
import {
  LaunchDefinitionRepository,
  launchCatalogRevision,
} from "./launch-definition.repository.js";
import { LaunchDefinitionService } from "./launch-definition.service.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "launch-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = { id: "proj_one", directory } as Project;
  const getProject = () => project;
  const repository = new LaunchDefinitionRepository(getProject);
  const events: unknown[] = [];
  const service = new LaunchDefinitionService(
    repository,
    getProject,
    async (...event) => {
      events.push(event);
    },
  );
  const storage = join(directory, ".nerve", "launches");
  const path = join(storage, "definitions.json");
  return { directory, project, repository, service, events, storage, path };
}
const config = (command = "echo test") =>
  createLaunchDefinitionRequestSchema.parse({ command });
const legacyDefinition = (id: string, label?: string) => ({
  id,
  scope: { kind: "project", projectId: "proj_foreign" },
  label,
  command: " echo test ",
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
});

void test("v1 reads are lossless and read-only; first mutation backs up exact current bytes", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.service.catalog("proj_one")).definitions, []);
  assert.deepEqual(await readdir(f.directory), []);
  await mkdir(f.storage, { recursive: true });
  const source = JSON.stringify(
    {
      version: 1,
      definitions: [
        legacyDefinition("launchdef_a"),
        legacyDefinition("launchdef_b", "Same"),
        legacyDefinition("launchdef_c", "Same"),
      ],
    },
    null,
    3,
  );
  await writeFile(f.path, source);
  const catalog = await f.service.catalog("proj_one");
  assert.deepEqual(
    catalog.definitions.map((d) => [
      d.label,
      d.order,
      d.command,
      d.scope.projectId,
    ]),
    [
      [undefined, 0, " echo test ", "proj_one"],
      ["Same", 1, " echo test ", "proj_one"],
      ["Same", 2, " echo test ", "proj_one"],
    ],
  );
  assert.equal(await readFile(f.path, "utf8"), source);
  const newerBytes = `${source}\n`;
  await writeFile(f.path, newerBytes);
  const result = await f.service.createFolder(
    "proj_one",
    { label: " Dev ", parentFolderId: null, beforeSibling: null },
    catalog.revision,
  );
  assert.equal(result.folder.label, "Dev");
  assert.equal(
    await readFile(join(f.storage, "definitions.v1.backup.json"), "utf8"),
    newerBytes,
  );
  const saved = JSON.parse(await readFile(f.path, "utf8"));
  assert.equal(saved.version, 2);
  assert.equal(saved.definitions[0].label, undefined);
  assert.deepEqual(saved.definitions[0].scope, { kind: "project" });
  assert.equal(saved.definitions[0].runPolicy, "single");
});

void test("digest ignores representation order and retains placement and optional labels", () => {
  const file = launchDefinitionFileSchema.parse({
    version: 2,
    folders: [],
    definitions: [
      legacyDefinition("launchdef_a"),
      legacyDefinition("launchdef_b", "Same"),
    ].map((d, order) => ({
      ...d,
      scope: { kind: "project" },
      parentFolderId: null,
      order,
    })),
  });
  const revision = launchCatalogRevision(file);
  assert.equal(
    revision,
    launchCatalogRevision({
      ...file,
      definitions: [...file.definitions].reverse(),
    }),
  );
  const swapped = structuredClone(file);
  swapped.definitions[0].order = 1;
  swapped.definitions[1].order = 0;
  assert.notEqual(revision, launchCatalogRevision(swapped));
  const reverseKeys = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reverseKeys)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, val]) => [k, reverseKeys(val)]),
          )
        : v;
  assert.equal(
    revision,
    launchCatalogRevision(launchDefinitionFileSchema.parse(reverseKeys(file))),
  );
});

void test("mixed ordering, structural invariants, revision conflicts and true no-ops", async (t) => {
  const f = await fixture(t);
  let revision = (await f.service.catalog("proj_one")).revision;
  const a = await f.service.createFolder(
    "proj_one",
    { label: "A", parentFolderId: null, beforeSibling: null },
    revision,
  );
  revision = a.revision;
  const b = await f.service.createFolder(
    "proj_one",
    { label: "B", parentFolderId: null, beforeSibling: null },
    revision,
  );
  revision = b.revision;
  const d = await f.service.create("proj_one", config(), revision);
  revision = d.revision;
  const timestamp = d.definition.updatedAt;
  await assert.rejects(
    f.service.createFolder(
      "proj_one",
      { label: " a ", parentFolderId: null, beforeSibling: null },
      revision,
    ),
  );
  await assert.rejects(
    f.service.renameFolder("proj_one", b.folder.id, "a", revision),
  );
  await assert.rejects(
    f.service.create("proj_one", config(), a.revision),
    /changed/,
  );
  const moved = await f.service.move(
    "proj_one",
    {
      entry: { kind: "definition", id: d.definition.id },
      destinationFolderId: a.folder.id,
      beforeSibling: null,
    },
    revision,
  );
  revision = moved.revision;
  await assert.rejects(
    f.service.deleteFolder("proj_one", a.folder.id, revision),
    /not empty/,
  );
  const nested = await f.service.move(
    "proj_one",
    {
      entry: { kind: "folder", id: b.folder.id },
      destinationFolderId: a.folder.id,
      beforeSibling: { kind: "definition", id: d.definition.id },
    },
    revision,
  );
  revision = nested.revision;
  await assert.rejects(
    f.service.move(
      "proj_one",
      {
        entry: { kind: "folder", id: a.folder.id },
        destinationFolderId: b.folder.id,
        beforeSibling: null,
      },
      revision,
    ),
    /cycle/,
  );
  await assert.rejects(
    f.service.move(
      "proj_one",
      {
        entry: { kind: "folder", id: b.folder.id },
        destinationFolderId: null,
        beforeSibling: { kind: "definition", id: d.definition.id },
      },
      revision,
    ),
    /anchor/,
  );
  const bytes = await readFile(f.path, "utf8");
  const eventCount = f.events.length;
  assert.equal(
    (
      await f.service.move(
        "proj_one",
        {
          entry: { kind: "definition", id: d.definition.id },
          destinationFolderId: a.folder.id,
          beforeSibling: null,
        },
        revision,
      )
    ).revision,
    revision,
  );
  assert.equal(
    (await f.service.update("proj_one", d.definition.id, config(), revision))
      .revision,
    revision,
  );
  assert.equal(await readFile(f.path, "utf8"), bytes);
  assert.equal(f.events.length, eventCount);
  const snapshot = await f.service.catalog("proj_one");
  assert.equal(snapshot.definitions[0].updatedAt, timestamp);
  assert.equal(snapshot.folders.find((x) => x.id === b.folder.id)!.order, 0);
  assert.equal(snapshot.definitions[0].order, 1);
  const removed = await f.service.remove("proj_one", d.definition.id, revision);
  const deleted = await f.service.deleteFolder(
    "proj_one",
    b.folder.id,
    removed.revision,
  );
  await f.service.deleteFolder("proj_one", a.folder.id, deleted.revision);
  assert.deepEqual((await f.service.catalog("proj_one")).folders, []);
});

void test("invalid documents and conversion backup failures never overwrite authority", async (t) => {
  const f = await fixture(t);
  await mkdir(f.storage, { recursive: true });
  for (const raw of [
    { version: 99, definitions: [] },
    {
      version: 1,
      definitions: [
        legacyDefinition("launchdef_a"),
        legacyDefinition("launchdef_a"),
      ],
    },
    {
      version: 2,
      folders: [],
      definitions: [
        {
          ...legacyDefinition("launchdef_a"),
          scope: { kind: "project" },
          parentFolderId: "launchfolder_missing",
          order: 0,
        },
      ],
    },
  ]) {
    const bytes = JSON.stringify(raw);
    await writeFile(f.path, bytes);
    await assert.rejects(
      f.service.catalog("proj_one"),
      /Invalid project launch definitions/,
    );
    assert.equal(await readFile(f.path, "utf8"), bytes);
  }
  const bytes = JSON.stringify({ version: 1, definitions: [] });
  await writeFile(f.path, bytes);
  const revision = (await f.service.catalog("proj_one")).revision;
  const backup = join(f.storage, "definitions.v1.backup.json");
  await mkdir(backup);
  await assert.rejects(f.service.create("proj_one", config(), revision));
  assert.equal(await readFile(f.path, "utf8"), bytes);
  await rm(backup, { recursive: true });
  await writeFile(backup, "different");
  await assert.rejects(
    f.service.create("proj_one", config(), revision),
    /backup differs/,
  );
  assert.equal(await readFile(f.path, "utf8"), bytes);
  await writeFile(backup, bytes);
  await f.service.create("proj_one", config(), revision);
  await rm(f.path);
  await assert.rejects(f.service.catalog("proj_one"), /Missing authoritative/);
});

void test("publication failure acknowledges committed mutation", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const f = await fixture(t);
  const service = new LaunchDefinitionService(
    f.repository,
    () => f.project,
    async () => {
      throw new Error("offline");
    },
  );
  const result = await service.create(
    "proj_one",
    config(),
    (await service.catalog("proj_one")).revision,
  );
  assert.equal((await service.catalog("proj_one")).revision, result.revision);
  assert.equal(errors.mock.callCount(), 2);
});

void test("canonical aliases and cooperating child process writers share fail-closed coordination", async (t) => {
  const f = await fixture(t);
  const alias = join(f.directory, "alias");
  await symlink(f.directory, alias);
  const aliasRepository = new LaunchDefinitionRepository(() => ({
    ...f.project,
    directory: alias,
  }));
  const revision = (await f.repository.catalog("proj_one")).revision;
  let acquired!: () => void;
  const started = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  // Keep transaction busy synchronously in a separate process, not an in-process queue.
  const repositoryUrl = new URL(
    "./launch-definition.repository.ts",
    import.meta.url,
  ).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { existsSync } from "node:fs"; import { LaunchDefinitionRepository } from ${JSON.stringify(repositoryUrl)}; const repository = new LaunchDefinitionRepository(() => ({ directory: ${JSON.stringify(alias)} })); await repository.transact('proj_one', ${JSON.stringify(revision)}, file => { process.stdout.write('locked\\n'); const deadline = Date.now() + 10000; while (!existsSync(${JSON.stringify(join(f.directory, "release-child"))})) { if (Date.now() > deadline) throw new Error("Timed out waiting for parent"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); } file.folders.push({ id: 'launchfolder_child', label: 'Child', parentFolderId: null, order: 0 }); });`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(async () => {
    child.kill();
  });
  const exit = new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr)),
    );
  });
  child.stdout.on("data", () => acquired());
  await Promise.race([
    started,
    exit.then(() => {
      throw new Error("Child exited without lock");
    }),
  ]);
  await assert.rejects(
    aliasRepository.transact("proj_one", revision, () => undefined),
    /exclusively lock/,
  );
  await writeFile(join(f.directory, "release-child"), "release");
  await exit;
  await assert.rejects(
    f.repository.transact("proj_one", revision, () => undefined),
    /changed/,
  );
  assert.equal(
    (await aliasRepository.catalog("proj_one")).folders[0].id,
    "launchfolder_child",
  );
  const current = await aliasRepository.catalog("proj_one");
  await f.service.createFolder(
    "proj_one",
    { label: "Parent writer", parentFolderId: null, beforeSibling: null },
    current.revision,
  );
  assert.equal((await aliasRepository.catalog("proj_one")).folders.length, 2);
  // A leftover lock is never stolen on elapsed time or guessed process death.
  await writeFile(`${f.path}.lock`, "dead writer");
  await assert.rejects(
    f.repository.transact(
      "proj_one",
      (await f.repository.catalog("proj_one")).revision,
      () => undefined,
    ),
    /exclusively lock/,
  );
});

void test("folder move collision fails with explicit conflict and leaves source intact", async (t) => {
  const f = await fixture(t);
  const revision = (await f.service.catalog("proj_one")).revision;
  const parent = await f.service.createFolder(
    "proj_one",
    { label: "Parent", parentFolderId: null, beforeSibling: null },
    revision,
  );
  const root = await f.service.createFolder(
    "proj_one",
    { label: "Same", parentFolderId: null, beforeSibling: null },
    parent.revision,
  );
  const child = await f.service.createFolder(
    "proj_one",
    { label: "same", parentFolderId: parent.folder.id, beforeSibling: null },
    root.revision,
  );
  const bytes = await readFile(f.path, "utf8");
  await assert.rejects(
    f.service.move(
      "proj_one",
      {
        entry: { kind: "folder", id: root.folder.id },
        destinationFolderId: parent.folder.id,
        beforeSibling: null,
      },
      child.revision,
    ),
    (error) =>
      (error as { code?: string }).code === "LAUNCH_FOLDER_NAME_CONFLICT",
  );
  assert.equal(await readFile(f.path, "utf8"), bytes);
  assert.equal((await f.service.catalog("proj_one")).revision, child.revision);
});

void test("lock cleanup preserves an externally replaced lock instead of deleting its ownership", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const f = await fixture(t);
  const revision = (await f.service.catalog("proj_one")).revision;
  await f.repository.transact("proj_one", revision, () => {
    unlinkSync(`${f.path}.lock`);
    writeFileSync(`${f.path}.lock`, "replacement owner", {
      flag: "wx",
      mode: 0o600,
    });
  });
  assert.equal(await readFile(`${f.path}.lock`, "utf8"), "replacement owner");
  await assert.rejects(
    f.repository.transact("proj_one", revision, () => undefined),
    /exclusively lock/,
  );
});

void test("failed replacement retains v1 authority and completed backup is safely reusable", async (t) => {
  const f = await fixture(t);
  await mkdir(f.storage, { recursive: true });
  const source = JSON.stringify({
    version: 1,
    definitions: [legacyDefinition("launchdef_a")],
  });
  await writeFile(f.path, source);
  const failingRepository = new LaunchDefinitionRepository(
    () => f.project,
    async () => {
      throw new Error("injected atomic write failure");
    },
  );
  const service = new LaunchDefinitionService(
    failingRepository,
    () => f.project,
  );
  const revision = (await service.catalog("proj_one")).revision;
  await assert.rejects(
    service.create("proj_one", config(), revision),
    /injected atomic write failure/,
  );
  assert.equal(await readFile(f.path, "utf8"), source);
  assert.equal(
    await readFile(join(f.storage, "definitions.v1.backup.json"), "utf8"),
    source,
  );
  const committed = await f.service.create("proj_one", config(), revision);
  assert.equal(
    (await f.service.catalog("proj_one")).revision,
    committed.revision,
  );
});

void test("invalid structural intent returns client errors without changing authority", async (t) => {
  const f = await fixture(t);
  const parent = await f.service.createFolder(
    "proj_one",
    { label: "Parent", parentFolderId: null, beforeSibling: null },
    (await f.service.catalog("proj_one")).revision,
  );
  const child = await f.service.createFolder(
    "proj_one",
    { label: "Child", parentFolderId: parent.folder.id, beforeSibling: null },
    parent.revision,
  );
  const revision = child.revision;
  const bytes = await readFile(f.path, "utf8");
  const entry = { kind: "folder" as const, id: parent.folder.id };
  const cases: [() => Promise<unknown>, number][] = [
    [
      () =>
        f.service.move(
          "proj_one",
          {
            entry,
            destinationFolderId: "launchfolder_missing",
            beforeSibling: null,
          },
          revision,
        ),
      404,
    ],
    [
      () =>
        f.service.move(
          "proj_one",
          {
            entry,
            destinationFolderId: null,
            beforeSibling: { kind: "definition", id: "launchdef_missing" },
          },
          revision,
        ),
      404,
    ],
    [
      () =>
        f.service.move(
          "proj_one",
          { entry, destinationFolderId: null, beforeSibling: entry },
          revision,
        ),
      400,
    ],
    [
      () =>
        f.service.move(
          "proj_one",
          { entry, destinationFolderId: parent.folder.id, beforeSibling: null },
          revision,
        ),
      400,
    ],
    [
      () =>
        f.service.move(
          "proj_one",
          { entry, destinationFolderId: child.folder.id, beforeSibling: null },
          revision,
        ),
      400,
    ],
    [() => f.service.deleteFolder("proj_one", parent.folder.id, revision), 409],
    [
      () =>
        f.service.renameFolder(
          "proj_one",
          "launchfolder_missing",
          "Name",
          revision,
        ),
      404,
    ],
    [
      () => f.service.renameFolder("proj_one", child.folder.id, " ", revision),
      400,
    ],
  ];
  for (const [action, status] of cases) {
    await assert.rejects(
      action(),
      (error) => (error as { status?: number }).status === status,
    );
    assert.equal(await readFile(f.path, "utf8"), bytes);
    assert.equal((await f.service.catalog("proj_one")).revision, revision);
  }
  await writeFile(`${f.path}.lock`, "busy writer");
  await assert.rejects(
    f.service.deleteFolder("proj_one", child.folder.id, revision),
    (error) => (error as { code?: string }).code === "LAUNCH_CATALOG_BUSY",
  );
  assert.equal(await readFile(f.path, "utf8"), bytes);
});
