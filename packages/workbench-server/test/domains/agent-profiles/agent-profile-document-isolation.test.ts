import assert from "node:assert/strict";
import { mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setup } from "./agent-profile-test-fixture.js";

void test("malformed or mismatched profiles remain isolated and deletion can repair the selected file", async () => {
  const { service, file, write } = await setup();
  await write("developer", { name: "wrong-name" });
  await write("explore", { instructions: "Valid sibling" });
  const result = await service.configuration({ scope: "user" });
  assert.ok(
    result.profiles.find((p) => p.name === "developer")?.diagnostics.length,
  );
  assert.equal(
    result.profiles.find((p) => p.name === "explore")?.effective?.instructions,
    "Valid sibling",
  );
  const bytes = await readFile(file("developer"), "utf8");
  await service.update({
    scope: "user",
    name: "explore",
    patch: { enabled: false },
  });
  assert.equal(await readFile(file("developer"), "utf8"), bytes);
  await service.reset({ scope: "user", name: "developer" });
  assert.deepEqual(
    (await service.list()).find((p) => p.name === "developer")?.permission,
    { set: "autonomous" },
  );
});

void test("profile paths reject traversal and symlinked owner directories", async () => {
  const { root, service, file } = await setup();
  await assert.rejects(
    service.update({
      scope: "user",
      name: "../escape",
      patch: { enabled: true },
    }),
  );
  const outside = join(root, "outside");
  await mkdir(outside);
  await mkdir(dirname(dirname(file("developer"))), { recursive: true });
  await symlink(outside, dirname(file("developer")));
  await assert.rejects(
    service.update({
      scope: "user",
      name: "developer",
      patch: { enabled: false },
    }),
    /symbolic/,
  );
  await assert.rejects(readFile(join(outside, "developer.json")), {
    code: "ENOENT",
  });
});
