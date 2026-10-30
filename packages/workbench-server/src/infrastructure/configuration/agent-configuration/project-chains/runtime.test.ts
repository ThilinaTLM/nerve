import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  fixture,
  put,
  lead,
  leadDocument,
  mutation,
} from "../agent-configuration-test-fixture.js";
void test("capability chain participates in resolution, sparse save normalization, health reload and reset", async (t) => {
  const f = await fixture(t);
  const directory = f.options.projectDirectory("p")!;
  const context = { projectId: "p", directory };
  const file = path.join(directory, ".nerve/config/capabilities.json");
  await put(file, {
    schemaVersion: 2,
    tools: { web_search: { enabled: false } },
  });
  const first = await f.service.getEffective("lead");
  assert.equal(first.status, "available");
  if (first.status !== "available") return;
  assert.equal(first.resolution.settings.tools?.web_search?.enabled, false);
  const inherited = await f.service.getInheritedSettings(lead);
  assert.equal(inherited.tools?.web_search?.enabled, false);
  const state = await f.service.ensureLoaded(lead);
  assert.notEqual(state.status, "unavailable");
  if (state.status === "unavailable") return;
  await f.service.save(
    lead,
    mutation(state.value.revision, state.value.digest, {
      tools: { web_search: { enabled: true } },
    }),
  );
  const changed = await f.service.getEffective("lead");
  assert.equal(changed.status, "available");
  if (changed.status === "available")
    assert.equal(changed.resolution.settings.tools?.web_search?.enabled, true);
  await put(f.service.paths.agent(lead), leadDocument);
  await f.service.reload(lead);
  await put(file, { schemaVersion: 4, overrides: {} });
  const newer = await f.service.projectMigration.resolve(context, {
    type: "capabilities",
    action: "reload",
  });
  assert.equal(
    newer.issues.find((issue) => issue.type === "capabilities")?.resetOffered,
    false,
  );
  const fallback = await f.service.getEffective("lead");
  assert.equal(fallback.status, "available");
  if (fallback.status === "available")
    assert.equal(fallback.resolution.settings.tools?.web_search?.enabled, true);
  await put(file, { schemaVersion: 3, overrides: {}, unexpected: true });
  await f.service.projectMigration.resolve(context, {
    type: "capabilities",
    action: "reload",
  });
  await f.service.projectMigration.resolve(context, {
    type: "capabilities",
    action: "reset",
    confirmed: true,
  });
  await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.equal(
    f.service.projectMigration
      .health("p")
      .issues.some((issue) => issue.type === "capabilities"),
    false,
  );
});

void test("catalog and Markdown legacy names never appear as profiles in runtime or settings catalogs", async (t) => {
  const f = await fixture(t);
  const root = path.join(f.options.projectDirectory("p")!, ".nerve");
  await put(path.join(root, "config/subagents.json"), {
    schemaVersion: 1,
    profiles: {
      "catalog-only": { description: "Old profile", instructions: "Do work" },
    },
  });
  const markdown = path.join(root, "subagents/markdown-only.md");
  await put(markdown, "Old Markdown is not decoded");
  const runtime = await f.service.profiles.list("p", "child");
  assert.deepEqual(Object.keys(runtime.profiles), ["coding"]);
  const editing = await f.service.profiles.listForEditing(
    { scope: "project", projectId: "p" },
    "child",
  );
  assert.deepEqual(
    editing.profiles.map((profile) => profile.name),
    ["coding"],
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, "config/subagents.json"), "utf8"))
      .version,
    2,
  );
  assert.deepEqual(
    f.service.projectMigration
      .health("p")
      .issues.find((issue) => issue.classification === "legacy")?.files,
    [markdown],
  );
  for (const name of ["catalog-only", "markdown-only"])
    await assert.rejects(
      readFile(path.join(root, "agent-profiles", `${name}.json`)),
      { code: "ENOENT" },
    );
});
