import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";
import { listPermissionRuleSets } from "./permission-rule-sets.js";

void test("rule set listing isolates malformed, invalid and unreadable files", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "permission-list-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, "config", "rule-sets");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "syntax.json"), "{");
  await writeFile(join(directory, "invalid.json"), "{}");
  await mkdir(join(directory, "directory.json"));
  const valid = {
    ...builtInPermissionRuleSets[0],
    id: "custom",
    name: "Custom",
  };
  await writeFile(join(directory, "valid.json"), JSON.stringify(valid));
  const result = await listPermissionRuleSets(home);
  assert.equal(result.length, builtInPermissionRuleSets.length + 1);
  assert.ok(result.some((item) => item.id === "custom"));
});
