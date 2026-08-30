import assert from "node:assert/strict";
import test from "node:test";
import { serverTestRuntimePolicyViolations } from "./server-test-runtime-policy.mjs";

const file = "packages/workbench-server/test/support/runtime-fixture.ts";

test("server tests retain runtime and services as separate fixture fields", () => {
  assert.deepEqual(
    serverTestRuntimePolicyViolations(
      file,
      "const fixture = { runtime, services }; createApp(fixture.runtime);",
    ),
    [],
  );
});

test("server tests reject runtime service augmentation", () => {
  assert.deepEqual(
    serverTestRuntimePolicyViolations(
      file,
      "const fixture = Object.assign(runtime, { services: composed });",
    ),
    ["server tests must not augment ServerRuntime with services"],
  );
  assert.deepEqual(
    serverTestRuntimePolicyViolations(
      file,
      "type Fixture = ServerRuntime & { services: RuntimeServices };",
    ),
    ["server tests must not augment ServerRuntime with services"],
  );
});
