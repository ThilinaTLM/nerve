import assert from "node:assert/strict";
import { test } from "node:test";
import { composerProfileItems } from "./composer-profile-items.js";

test("profile groups use catalog sources, not profile names", () => {
  const items = composerProfileItems([
    {
      name: "coding",
      label: "My coding profile",
      source: "project",
      whenToUse: "Project conventions",
    },
    { name: "personal", label: "Personal agent", source: "user" },
    { name: "stock", label: "Stock agent", source: "builtin" },
    { name: "unknown", label: "Unknown source" },
  ]);
  assert.deepEqual(
    items.map(({ key, group }) => ({ key, group })),
    [
      { key: "coding", group: "Project" },
      { key: "personal", group: "Personal" },
      { key: "stock", group: "Built-in" },
      { key: "unknown", group: "Profiles" },
    ],
  );
  assert.equal(items[0].detail, "Project conventions");
});
