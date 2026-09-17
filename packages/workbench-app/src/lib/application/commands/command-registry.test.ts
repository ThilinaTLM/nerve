import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SHORTCUTS, getShortcutBinding } from "./command-registry";

test("publishes the composer power shortcuts used by settings", () => {
  assert.deepEqual(getShortcutBinding("composer.toggleMode"), {
    key: "tab",
    shift: true,
  });
  assert.deepEqual(getShortcutBinding("composer.cycleModel"), {
    key: "m",
    alt: true,
  });
  assert.deepEqual(getShortcutBinding("composer.cycleThinking"), {
    key: "t",
    alt: true,
  });
  assert.deepEqual(getShortcutBinding("composer.cyclePermission"), {
    key: "p",
    alt: true,
  });

  const bindings = DEFAULT_SHORTCUTS.filter((command) =>
    [
      "composer.toggleMode",
      "composer.cycleModel",
      "composer.cycleThinking",
      "composer.cyclePermission",
    ].includes(command.id),
  ).map((command) => JSON.stringify(command.defaultBinding));
  assert.equal(new Set(bindings).size, bindings.length);
});
