import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  buildBashToolDefinition,
  shellToolDefinitions,
} from "./shell.tools.js";

void test("promotion settings define bash schema and exact description per turn", () => {
  const enabled = buildBashToolDefinition({
    autoPromotion: { enabled: true, afterMs: 2500 },
    maxTimeoutMs: 900000,
  });
  assert.deepEqual(Object.keys(enabled.parameters.properties), [
    "command",
    "cwd",
    "projectEnvironment",
    "background",
    "ready",
  ]);
  assert.ok(
    Value.Check(enabled.parameters, {
      command: "echo",
      background: true,
      ready: "listening",
    }),
  );
  assert.ok(!Value.Check(enabled.parameters, { command: "echo", timeout: 1 }));
  assert.equal(
    enabled.description,
    "Run a shell command in the project. Prefer read/grep/find/ls for inspection and launch for the user's servers. Moves to the background after 2.5s (`background: true` returns at once); background runs notify you on exit. Large output is saved to files for read/grep.",
  );
  assert.equal(
    shellToolDefinitions[0].description,
    buildBashToolDefinition(defaultSettings.tools.bash).description,
  );
  const disabled = buildBashToolDefinition({
    autoPromotion: { enabled: false, afterMs: 120000 },
    maxTimeoutMs: 900000,
  });
  for (const definition of [shellToolDefinitions[0], enabled, disabled]) {
    const base = {
      command: "echo",
      ...(definition === disabled ? { timeout: 1 } : {}),
    };
    assert.ok(Value.Check(definition.parameters, base));
    for (const projectEnvironment of [true, false]) {
      assert.ok(
        Value.Check(definition.parameters, { ...base, projectEnvironment }),
      );
    }
    for (const projectEnvironment of [null, "false", 0, 1, {}]) {
      assert.ok(
        !Value.Check(definition.parameters, { ...base, projectEnvironment }),
      );
    }
  }
  assert.deepEqual(disabled.parameters.required, ["command", "timeout"]);
  for (const timeout of [1, 900])
    assert.ok(Value.Check(disabled.parameters, { command: "echo", timeout }));
  for (const timeout of [undefined, 0, 901, 1.5])
    assert.ok(!Value.Check(disabled.parameters, { command: "echo", timeout }));
  assert.match(
    disabled.description,
    /Requires timeout \(max 900s\); the process is killed when it expires\. `background: true` returns at once;/,
  );
});
