import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { context, setup } from "./agent-profile-test-fixture.js";

void test("draft arrays validate complete templates without writing files, events or trust", async () => {
  const { service, file, write, changes } = await setup();
  await write(
    "developer",
    { instructions: "Untrusted project template" },
    "project",
  );
  const before = await readFile(file("developer", "project"), "utf8");
  const preview = await service.preview({
    projectId: context.projectId,
    profiles: [
      {
        name: "developer",
        description: "Draft",
        usableBy: "both",
        instructions: "Draft instructions",
      },
    ],
    lead: {
      model: { provider: "test", modelId: "model" },
      reasoningLevel: "off",
    },
  });
  const draft = preview.profiles.find((p) => p.name === "developer")!;
  assert.equal(draft.effective?.instructions, "Draft instructions");
  assert.equal(draft.effective?.permission, undefined);
  assert.equal(await readFile(file("developer", "project"), "utf8"), before);
  assert.equal((await service.find(context, "developer"))?.trust, "untrusted");
  assert.deepEqual(changes, []);
});
