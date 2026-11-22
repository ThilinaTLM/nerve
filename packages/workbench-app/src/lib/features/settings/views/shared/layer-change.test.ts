import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLayerChange } from "./layer-change";

function recorder() {
  const writes: string[] = [];
  return {
    writes,
    writeUser: (value: boolean | undefined) =>
      void writes.push(`user:${value}`),
    writeProject: (value: boolean | undefined) =>
      void writes.push(`project:${value}`),
  };
}

void test("a project switch flipped back to the user's value clears only the project choice", async () => {
  const r = recorder();
  await applyLayerChange({
    value: { builtinDefault: true, user: false, project: true },
    layer: "project",
    next: false,
    ...r,
  });
  assert.deepEqual(r.writes, ["project:undefined"]);
});

void test("a user change that makes User equal the project clears both overrides in order", async () => {
  const r = recorder();
  await applyLayerChange({
    value: { builtinDefault: true, user: false, project: true },
    layer: "user",
    next: true,
    ...r,
  });
  assert.deepEqual(r.writes, ["user:undefined", "project:undefined"]);
});

void test("a value that changes nothing writes nothing", async () => {
  const r = recorder();
  await applyLayerChange({
    value: { builtinDefault: true },
    layer: "user",
    next: true,
    ...r,
  });
  assert.deepEqual(r.writes, []);
});
