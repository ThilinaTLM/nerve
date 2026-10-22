import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { context, setup } from "./agent-profile-test-fixture.js";

void test("complete per-file overrides do not inherit fields and reset unlinks only the selected file", async () => {
  const { service, file, write } = await setup();
  await write("developer", {
    permission: { set: "read_only" },
    instructions: "User rules",
  });
  await service.update({
    scope: "project",
    projectId: context.projectId,
    name: "developer",
    expectedDigest: null,
    patch: { instructions: "Project rules" },
  });
  const config = await service.configuration({
    scope: "project",
    projectId: context.projectId,
  });
  const local = config.profiles.find((p) => p.name === "developer")!;
  assert.equal(local.effective?.instructions, "Project rules");
  assert.deepEqual(local.effective?.permission, { set: "read_only" });
  await write(
    "developer",
    { instructions: "Standalone project template" },
    "project",
  );
  assert.equal(
    (await service.find(context, "developer"))?.permission,
    undefined,
    "omission is Use settings, not field inheritance",
  );
  const before = await readFile(file("developer"), "utf8");
  await service.reset({
    scope: "project",
    projectId: context.projectId,
    name: "developer",
  });
  await assert.rejects(readFile(file("developer", "project")), {
    code: "ENOENT",
  });
  assert.equal(
    (await service.find(context, "developer"))?.instructions,
    "User rules",
  );
  assert.equal(await readFile(file("developer"), "utf8"), before);
});

void test("project trust covers exact named bytes and never approves a sibling or silently reapproves an imported edit", async () => {
  const { service, file, write } = await setup();
  await write("developer", { instructions: "Developer import" }, "project");
  await write("explore", { instructions: "Explore import" }, "project");
  const input = { scope: "project" as const, projectId: context.projectId };
  const initial = await service.configuration(input);
  const developer = initial.profiles.find((p) => p.name === "developer")!;
  await service.trust(context.projectId, "developer", developer.digest!);
  assert.equal((await service.find(context, "developer"))?.trust, "trusted");
  assert.equal((await service.find(context, "explore"))?.trust, "untrusted");
  await service.update({ ...input, name: "explore", patch: { enabled: true } });
  assert.equal((await service.find(context, "explore"))?.trust, "untrusted");
  await writeFile(
    file("developer", "project"),
    `${await readFile(file("developer", "project"), "utf8")}\n`,
  );
  await assert.rejects(
    service.trust(context.projectId, "developer", developer.digest!),
    /changed/,
  );
  assert.equal((await service.find(context, "developer"))?.trust, "untrusted");
});

void test("per-file concurrency rejects stale and competing saves without involving sibling digests", async () => {
  const { service, write } = await setup();
  await write("developer", {});
  const entry = (await service.configuration({ scope: "user" })).profiles.find(
    (p) => p.name === "developer",
  )!;
  await write("explore", { instructions: "Unrelated edit" });
  const input = {
    scope: "user" as const,
    name: "developer",
    expectedDigest: entry.digest,
  };
  const results = await Promise.allSettled([
    service.update({ ...input, patch: { instructions: "First" } }),
    service.update({ ...input, patch: { instructions: "Second" } }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});

void test("invalid filenames are isolated diagnostics and cannot hide valid templates", async () => {
  const { service, file, write } = await setup();
  await write("developer", { instructions: "Valid template" });
  await writeFile(file("bad.name"), "{}");
  const configuration = await service.configuration({ scope: "user" });
  assert.equal(
    configuration.profiles.find((profile) => profile.name === "developer")
      ?.effective?.instructions,
    "Valid template",
  );
  assert(
    configuration.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid_filename" &&
        diagnostic.reference === "bad.name.json",
    ),
  );
});
