import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import { createStepContext } from "../../framework/context.js";
import { RollbackJournal } from "../../framework/rollback-journal.js";
import {
  convertClientAppearance,
  upgradeClientAppearance,
} from "./client-appearance.js";

void test("client appearance conversion removes only theme and mode without mutating input", () => {
  const before = {
    version: 1,
    appearance: {
      theme: "ocean",
      colorMode: "dark",
      zoomLevel: 3,
      future: true,
    },
    desktop: { headerType: "linux" },
    theme: "untouched",
  };
  assert.deepEqual(convertClientAppearance(before), {
    ...before,
    appearance: { zoomLevel: 3, future: true },
  });
  assert.equal(before.appearance.theme, "ocean");
  for (const value of [null, [], {}, { appearance: { zoomLevel: 2 } }])
    assert.deepEqual(convertClientAppearance(value), value);
});

void test("home UI upgrade preserves fields, journals originals, and skips unchanged or unreadable files", (t) => {
  const home = mkdtempSync(join(tmpdir(), "nerve-client-appearance-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const { context } = createStepContext(
    storagePaths(home),
    "0002-agent-profiles",
    "Client appearance",
    () => {},
  );
  const path = join(home, "config", "ui.json");
  upgradeClientAppearance(context); // missing
  mkdirSync(join(home, "config"), { recursive: true });
  for (const bytes of [
    "broken JSON",
    '{ "appearance": { "zoomLevel": 2 }, "other": true }\n',
  ]) {
    writeFileSync(path, bytes);
    upgradeClientAppearance(context);
    upgradeClientAppearance(context, true);
    assert.equal(readFileSync(path, "utf8"), bytes);
  }
  const original =
    '{"appearance":{"theme":"rose","colorMode":"light","zoomLevel":2},"other":true}';
  writeFileSync(path, original);
  assert.throws(() => upgradeClientAppearance(context, true), /not upgraded/);
  upgradeClientAppearance(context);
  upgradeClientAppearance(context, true);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    appearance: { zoomLevel: 2 },
    other: true,
  });
  new RollbackJournal(context.scratchDir).restore();
  assert.equal(readFileSync(path, "utf8"), original);
});
