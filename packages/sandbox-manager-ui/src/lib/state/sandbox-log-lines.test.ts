import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSandboxLogChunks } from "./sandbox-log-lines";

const ts = "2026-07-10T12:00:00.000Z";

describe("parseSandboxLogChunks", () => {
  it("parses structured records split across container chunks", () => {
    const lines = parseSandboxLogChunks([
      {
        stream: "stdout",
        chunk: '{"ts":"2026-07-10T12:00:00.000Z","level":"info","message":"sandbox startup ',
      },
      {
        stream: "stdout",
        chunk: 'stage started","stage":"preflight","attempt":1}\n',
      },
    ]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.structured, true);
    assert.equal(lines[0]?.stage, "preflight");
    assert.equal(lines[0]?.context.attempt, 1);
  });

  it("retains malformed and plain stderr output", () => {
    const lines = parseSandboxLogChunks([
      { stream: "stderr", chunk: "plain failure\n{not-json}\n", ts },
    ]);
    assert.deepEqual(
      lines.map((line) => [line.message, line.level, line.structured]),
      [
        ["plain failure", "error", false],
        ["{not-json}", "error", false],
      ],
    );
  });

  it("extracts boot phase and leaves remaining fields as context", () => {
    const lines = parseSandboxLogChunks([
      {
        stream: "stderr",
        chunk: `${JSON.stringify({
          ts,
          level: "error",
          message: "boot command failed",
          phase: "install",
          exitCode: 127,
          stderrPreview: "pnpm: not found",
        })}\n`,
      },
    ]);
    assert.equal(lines[0]?.phase, "install");
    assert.equal(lines[0]?.context.exitCode, 127);
    assert.equal(lines[0]?.context.stderrPreview, "pnpm: not found");
  });
});
