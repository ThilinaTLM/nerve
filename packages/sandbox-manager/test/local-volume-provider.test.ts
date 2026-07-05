import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalVolumeProvider } from "../src/storage/local-volume-provider.js";

function mode(value: number): number {
  return value & 0o777;
}

describe("LocalVolumeProvider", () => {
  it("materializes config and controller token readable by the sandbox container user", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-volumes-"));
    try {
      const provider = new LocalVolumeProvider(root);
      await provider.materialize("sbx_readable", {
        configYaml: "version: 1\n",
        controllerToken: "ntok_test",
      });

      const base = path.join(root, "sbx_readable");
      assert.equal(
        mode((await stat(path.join(base, "workspace"))).mode),
        0o777,
      );
      assert.equal(mode((await stat(path.join(base, "state"))).mode), 0o777);
      assert.equal(mode((await stat(path.join(base, "config"))).mode), 0o755);
      assert.equal(mode((await stat(path.join(base, "secrets"))).mode), 0o755);
      assert.equal(
        mode((await stat(path.join(base, "config", "sandbox.yaml"))).mode),
        0o644,
      );
      assert.equal(
        mode((await stat(path.join(base, "secrets", "controller-token"))).mode),
        0o644,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
