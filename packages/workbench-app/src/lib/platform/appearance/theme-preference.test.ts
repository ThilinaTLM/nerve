import assert from "node:assert/strict";
import test from "node:test";
import { migrateStoredTheme } from "./theme-preference";

const theme = (stored: Record<string, string>, prefersDark = false) =>
  migrateStoredTheme((key) => stored[key] ?? null, prefersDark);

test("migrates the light/dark/colour-mode keys into one theme", () => {
  assert.equal(theme({}), "nerve-dark", "nothing stored");
  assert.equal(theme({}, true), "nerve-dark");
  assert.equal(
    theme({
      "mode-watcher-mode": "light",
      "nerve-light-theme": "melange-light",
      "nerve-dark-theme": "graphite",
    }),
    "melange-light",
  );
  assert.equal(
    theme({ "mode-watcher-mode": "dark", "nerve-dark-theme": "graphite" }),
    "graphite",
  );
  const both = {
    "nerve-light-theme": "melange-light",
    "nerve-dark-theme": "melange-dark",
  };
  assert.equal(
    theme({ ...both, "mode-watcher-mode": "system" }, false),
    "melange-light",
  );
  assert.equal(theme(both, true), "melange-dark", "absent mode is system");
  assert.equal(
    theme({ "nerve-color-theme": "solar", "mode-watcher-mode": "dark" }),
    "graphite",
  );
  assert.equal(theme({ "nerve-color-theme": "solar" }, false), "nerve-light");
  // A system mode with no theme keys keeps the new default.
  assert.equal(theme({ "mode-watcher-mode": "system" }, false), "nerve-dark");
  // Old slots of the wrong kind fall back to that kind's Nerve theme.
  assert.equal(
    theme({ "mode-watcher-mode": "light", "nerve-light-theme": "graphite" }),
    "nerve-light",
  );
});

test("an existing or invalid nerve-theme wins over old keys", () => {
  assert.equal(
    theme({ "nerve-theme": "graphite", "mode-watcher-mode": "light" }),
    "graphite",
  );
  assert.equal(theme({ "nerve-theme": "garbage" }), "nerve-dark");
  assert.equal(
    theme({
      "mode-watcher-mode": "garbage",
      "nerve-color-theme": "garbage",
      "nerve-light-theme": "garbage",
    }),
    "nerve-dark",
    "garbage old keys count as nothing stored",
  );
});
