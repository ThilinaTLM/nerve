import assert from "node:assert/strict";
import { test } from "node:test";
import { toolSettingsMutation } from "./tool-settings-mutation";
test("clearing an account emits a reset, not an omitted update that leaves the old account selected", () => {
  const result = toolSettingsMutation(
    "web_search",
    { enabled: true, profileId: undefined },
    { tools: { web_search: { enabled: true, profileId: "old" } } },
  );
  assert.deepEqual(result.changes, {
    tools: { web_search: { enabled: true } },
  });
  assert.deepEqual(result.resets, ["/overrides/tools/web_search/profileId"]);
});
test("clearing a scalar tool setting removes only the local choice, never inherited settings", () => {
  const result = toolSettingsMutation(
    "python_exec",
    { enabled: true, settings: { interpreterPath: undefined } },
    {
      tools: { python_exec: { settings: { interpreterPath: "/old/python" } } },
    },
  );
  assert.deepEqual(result.resets, [
    "/overrides/tools/python_exec/settings/interpreterPath",
  ]);
  assert.deepEqual(
    toolSettingsMutation("python_exec", { settings: {} }, {}).resets,
    [],
  );
});
