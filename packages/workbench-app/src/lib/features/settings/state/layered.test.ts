import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLayer, effective, setLayer, userEffective } from "./layered";

void test("effective values follow project, then user, then the built-in default", () => {
  assert.equal(effective({ builtinDefault: true }), true);
  assert.equal(effective({ builtinDefault: true, user: false }), false);
  assert.equal(
    effective({ builtinDefault: true, user: false, project: true }),
    true,
  );
  assert.equal(
    userEffective({ builtinDefault: true, user: false, project: true }),
    false,
  );
});

void test("flipping the project switch to the user's value clears the project override", () => {
  const base = { builtinDefault: true, user: false };
  assert.deepEqual(setLayer(base, "project", true), {
    user: false,
    project: true,
  });
  assert.deepEqual(setLayer({ ...base, project: true }, "project", false), {
    user: false,
    project: undefined,
  });
  // With no user choice the user's value is the built-in default.
  assert.deepEqual(setLayer({ builtinDefault: true }, "project", true), {
    user: undefined,
    project: undefined,
  });
});

void test("a user change that equals the project value clears the project override", () => {
  assert.deepEqual(
    setLayer(
      { builtinDefault: true, user: false, project: true },
      "user",
      true,
    ),
    { user: undefined, project: undefined },
  );
  // A user change that differs keeps the project override.
  assert.deepEqual(
    setLayer({ builtinDefault: true, project: false }, "user", false),
    { user: false, project: undefined },
  );
  assert.deepEqual(
    setLayer({ builtinDefault: true, project: true }, "user", false),
    { user: false, project: true },
  );
});

void test("clearing the user choice drops a project choice that now matches the default", () => {
  assert.deepEqual(
    clearLayer({ builtinDefault: true, user: false, project: true }, "user"),
    { user: undefined, project: undefined },
  );
  assert.deepEqual(
    clearLayer({ builtinDefault: true, user: true, project: false }, "user"),
    { user: undefined, project: false },
  );
  assert.deepEqual(
    clearLayer({ builtinDefault: true, user: false, project: true }, "project"),
    { user: false, project: undefined },
  );
});

void test("custom equality compares structured values", () => {
  const same = (a: { n: number }, b: { n: number }) => a.n === b.n;
  assert.deepEqual(
    setLayer(
      { builtinDefault: { n: 1 }, user: { n: 2 } },
      "project",
      { n: 2 },
      same,
    ),
    { user: { n: 2 }, project: undefined },
  );
});
