import assert from "node:assert/strict";
import test from "node:test";
import { configurationMethods } from "./configuration-methods.js";

void test("list rejects a filter value no resource can have, naming the valid ones", async () => {
  const list = configurationMethods.find((method) => method.path === "list")!;
  const env = {} as Parameters<typeof list.prepare>[1];
  await assert.rejects(
    list.prepare([{ kind: "extensions" }], env),
    /kind must be one of .*"extension"/,
  );
  await assert.rejects(
    list.prepare([{ state: "pending" }], env),
    /state must be one of .*"needs_approval"/,
  );
});
