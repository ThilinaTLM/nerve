import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "@nervekit/test-kit";
import { mutatePermissionOverlay } from "./permission-overlays.js";

void test("overlay mutations on one file run in call order and a failure does not block the next", async (t) => {
  const dir = await makeTempDir(t, "nerve-overlays-");
  const path = join(dir, "permissions.json");
  await writeFile(path, JSON.stringify({ schemaVersion: 2, overlays: [] }));
  const order: string[] = [];
  const results = await Promise.allSettled([
    mutatePermissionOverlay("user", path, () => {
      order.push("first");
      throw new Error("first failed");
    }),
    mutatePermissionOverlay("user", path, () => {
      order.push("second");
    }),
    mutatePermissionOverlay("user", path, () => {
      order.push("third");
    }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "fulfilled", "fulfilled"],
  );
  assert.deepEqual(order, ["first", "second", "third"]);
});
