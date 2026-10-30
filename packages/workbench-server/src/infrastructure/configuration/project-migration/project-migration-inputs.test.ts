import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ProjectMigrationService,
  type ProjectConfigurationType,
} from "./project-migration.js";
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
