import assert from "node:assert/strict";
import test from "node:test";
import { runMigrations } from "../../framework/runner.js";
import { fixture, registry } from "./step-fixture.js";
import { LegacyReader } from "./legacy.reader.js";

void test("verification uses retained import receipts rather than source history or conversation scans", async (t) => {
  const home = await fixture(t);
  const record = LegacyReader.prototype.record;
  const conversations = LegacyReader.prototype.conversations;
  t.after(() => {
    LegacyReader.prototype.record = record;
    LegacyReader.prototype.conversations = conversations;
  });
  let verified = false;
  await runMigrations(home, {
    registry,
    onProgress: ({ phase }) => {
      if (phase !== "verify") return;
      verified = true;
      LegacyReader.prototype.record = () => {
        assert.fail("verification re-read source history");
      };
      LegacyReader.prototype.conversations = () => {
        assert.fail("verification re-scanned source conversations");
      };
    },
  });
  assert(verified);
});
