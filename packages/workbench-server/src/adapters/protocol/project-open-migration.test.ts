import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { moveProjectLaunchDefinitions } from "../../infrastructure/migrations/steps/0001-conversation-core/configuration.js";

void test("project-open conversion uses the frozen move, preserves collisions and is one-time", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "nerve-project-open-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const old = join(project, ".nerve/tasks/definitions.json"),
    target = join(project, ".nerve/launches/definitions.json");
  await mkdir(join(project, ".nerve/tasks"), { recursive: true });
  const source = JSON.stringify({
    version: 1,
    definitions: [{ id: "taskdef_one", command: "echo one" }],
  });
  await writeFile(old, source);
  assert.equal(moveProjectLaunchDefinitions(project), true);
  assert.equal(
    JSON.parse(await readFile(target, "utf8")).definitions[0].id,
    "launchdef_one",
  );
  assert.equal(moveProjectLaunchDefinitions(project), false);
  await writeFile(old, source);
  const before = await readFile(target, "utf8"),
    diagnostics: string[] = [];
  assert.equal(
    moveProjectLaunchDefinitions(project, (message) =>
      diagnostics.push(message),
    ),
    false,
  );
  assert.equal(await readFile(target, "utf8"), before);
  assert.equal(await readFile(old, "utf8"), source);
  assert.match(diagnostics[0], /collision/);
});
