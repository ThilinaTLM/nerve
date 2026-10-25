import assert from "node:assert/strict";
import { test } from "node:test";
import {
  A,
  B,
  user,
  project,
  definition,
  fixture,
  mutation,
} from "./agent-configuration-test-fixture.js";

void test("project defaults are shared in memory and draft overrides never contaminate them", async (t) => {
  const { service } = await fixture(t);
  const input = { projectId: "p" };
  const [first, second] = await Promise.all([
    service.projectDefaults.get(input),
    service.projectDefaults.get(input),
  ]);
  assert.equal(first.status, "available");
  if (first.status !== "available") return;
  assert.equal(first, second, "concurrent readers share a projection");
  assert.equal(await service.projectDefaults.get(input), first);
  assert.deepEqual(first.resolution.settings.model, A);
  assert.equal(first.appliedProfile.name, "coding");

  const draft = await service.projectDefaults.get({
    ...input,
    overrides: { model: B },
  });
  assert.equal(draft.status, "available");
  if (draft.status === "available")
    assert.deepEqual(draft.resolution.settings.model, B);
  assert.equal(await service.projectDefaults.get(input), first);

  const state = await service.ensureLoaded(user);
  assert.notEqual(state.status, "unavailable");
  if (state.status === "unavailable") return;
  await service.save(
    user,
    mutation(state.value.revision, state.value.digest, { model: B }),
  );
  const changed = await service.projectDefaults.get(input);
  assert.notEqual(changed, first);
  assert.equal(changed.status, "available");
  if (changed.status === "available")
    assert.deepEqual(changed.resolution.settings.model, B);
  const capture = await service.projectDefaults.capture(input);
  service.invalidateResources();
  assert.equal(
    capture.isCurrent(),
    false,
    "resource changes invalidate captures",
  );
  assert.notEqual(await service.projectDefaults.get(input), changed);
});

void test("project default projections follow creation preferences, profiles and explicit reloads", async (t) => {
  const { service, agent } = await fixture(t);
  const input = { projectId: "p" };
  const original = await service.projectDefaults.get(input);
  const planning = {
    ...definition,
    name: "planning",
    recommendations: { model: B },
  };
  await service.profiles.save(user, "planning", "missing", planning);
  const preferences = await service.loadCreation(project);
  assert.notEqual(preferences.status, "unavailable");
  if (preferences.status === "unavailable") return;
  await service.saveCreation(
    project,
    mutation(preferences.value.revision, preferences.value.digest, {
      defaultAgentProfile: "planning",
    }),
  );
  const changed = await service.projectDefaults.get(input);
  assert.notEqual(changed, original);
  assert.equal(changed.status, "available");
  if (changed.status === "available")
    assert.equal(changed.appliedProfile.name, "planning");
  const capture = await service.projectDefaults.capture(input);
  const profile = await service.profiles.get("planning", "p");
  assert.equal(profile.status, "available");
  if (profile.status !== "available") return;
  await service.profiles.save(user, "planning", profile.digest, {
    ...planning,
    instructions: "Updated",
  });
  assert.equal(capture.isCurrent(), false);
  const updated = await service.projectDefaults.get(input);
  if (updated.status === "available")
    assert.equal(updated.appliedProfile.instructions, "Updated");
  await agent(user, { schemaVersion: 1, revision: 9, overrides: { model: B } });
  await service.reload(user);
  const reloaded = await service.projectDefaults.get(input);
  if (reloaded.status === "available")
    assert.deepEqual(reloaded.resolution.settings.model, B);
  else assert.fail("reloaded settings should be available");
});

void test("project-specific settings invalidate only the matching defaults projection", async (t) => {
  const { service } = await fixture(t);
  const first = await service.projectDefaults.get({ projectId: "p" });
  // Loading another project's catalog may advance global catalog generations;
  // establish both projections before checking project-local invalidation.
  await service.projectDefaults.get({ projectId: "other" });
  await service.projectDefaults.get({ projectId: "p" });
  const other = await service.projectDefaults.get({ projectId: "other" });
  const state = await service.ensureLoaded(project);
  if (state.status === "unavailable")
    assert.fail("Project settings unavailable");
  await service.save(
    project,
    mutation(state.value.revision, state.value.digest, { model: B }),
  );
  const changed = await service.projectDefaults.get({ projectId: "p" });
  assert.notEqual(changed, first);
  if (changed.status !== "available")
    assert.fail("Project defaults unavailable");
  assert.deepEqual(changed.resolution.settings.model, B);
  assert.equal(
    await service.projectDefaults.get({ projectId: "other" }),
    other,
  );
  if (other.status !== "available") assert.fail("Other defaults unavailable");
  assert.deepEqual(other.resolution.settings.model, A);
});

void test("invalid source files return unavailable defaults and recover after reload", async (t) => {
  const { service, agent } = await fixture(t);
  await agent(user, "not json");
  const unavailable = await service.projectDefaults.get({ projectId: "p" });
  assert.equal(unavailable.status, "unavailable");
  assert.ok(unavailable.diagnostics.length);
  await agent(user, { schemaVersion: 1, revision: 1, overrides: { model: A } });
  await service.reload(user);
  const recovered = await service.projectDefaults.get({ projectId: "p" });
  assert.equal(recovered.status, "available");
});
