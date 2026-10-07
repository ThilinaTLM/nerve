import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("development storage and child ownership behavior", () => {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    command,
    ["exec", "tsx", "--test", "scripts/development/test/storage-slot.test.ts"],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
