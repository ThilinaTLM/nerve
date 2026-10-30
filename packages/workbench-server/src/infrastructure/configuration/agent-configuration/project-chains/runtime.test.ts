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
