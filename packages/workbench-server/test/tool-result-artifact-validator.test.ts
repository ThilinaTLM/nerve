import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ToolResultArtifactValidator } from "../src/domains/tools/tool-result-artifact-validator.js";
import { ToolResultPayloadStore } from "../src/domains/tools/tool-result-payload-store.js";

const homes: string[] = [];
afterEach(async () =>
  Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  ),
);

const claim = (path: string) => ({
  id: "output",
  role: "overflow_recovery" as const,
  path,
  format: {
    kind: "text" as const,
    mediaType: "text/plain",
    encoding: "utf-8" as const,
  },
  label: "Output",
  recommendedTools: ["read" as const, "grep" as const],
});

describe("ToolResultArtifactValidator", () => {
  it("issues descriptors only for regular files under the per-call managed root", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-artifacts-"));
    homes.push(home);
    const payloads = new ToolResultPayloadStore(home);
    await payloads.initialize();
    const files = payloads.filesPath("conv_test", "tool_test");
    await mkdir(files, { recursive: true });
    const path = join(files, "stdout.txt");
    await writeFile(path, "hello\n");
    const validator = new ToolResultArtifactValidator(home, payloads);
    const [descriptor] = await validator.validateClaims(
      { conversationId: "conv_test", toolCallId: "tool_test" },
      [claim(path)],
    );
    assert.equal(descriptor?.availability, "available");
    assert.equal(descriptor?.size.bytes, 6);
    assert.deepEqual(descriptor?.access, { kind: "agent_file", path });
  });

  it("rejects symlink targets and paths outside managed roots without throwing", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-artifacts-"));
    homes.push(home);
    const payloads = new ToolResultPayloadStore(home);
    await payloads.initialize();
    const files = payloads.filesPath("conv_test", "tool_test");
    await mkdir(files, { recursive: true });
    const outside = join(home, "outside.txt");
    await writeFile(outside, "secret");
    const linked = join(files, "linked.txt");
    await symlink(outside, linked);
    const validator = new ToolResultArtifactValidator(home, payloads);
    const descriptors = await validator.validateClaims(
      { conversationId: "conv_test", toolCallId: "tool_test" },
      [claim(linked), claim(outside)],
    );
    assert.deepEqual(
      descriptors.map((item) => item.unavailableReason),
      ["symlink", "unsafe_path"],
    );
  });
});
