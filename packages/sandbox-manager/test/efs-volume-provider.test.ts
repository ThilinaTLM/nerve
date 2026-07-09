import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { EfsVolumeProvider } from "../src/storage/efs-volume-provider.js";

function mode(value: number): number {
  return value & 0o777;
}

describe("EfsVolumeProvider", () => {
  it("materializes ECS-ready EFS refs with manager-readable sources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-efs-"));
    try {
      const provider = new EfsVolumeProvider({
        mountRoot: root,
        rootDirectory: "/nerve/sandboxes",
      });
      const volumes = await provider.materialize("sbx_efs", {
        configYaml: "version: 1\n",
        controllerToken: "ntok_test",
      });

      assert.equal(volumes.workspace.kind, "efs");
      assert.equal(
        volumes.workspace.name,
        "/nerve/sandboxes/sbx_efs/workspace",
      );
      assert.equal(
        volumes.workspace.source,
        path.join(root, "sbx_efs", "workspace"),
      );
      assert.equal(volumes.config?.target, "/etc/nerve");
      assert.equal(
        volumes.config?.source,
        path.join(root, "sbx_efs", "config", "sandbox.yaml"),
      );
      assert.equal(volumes.tmp?.target, "/tmp");
      assert.equal(
        mode((await stat(path.join(root, "sbx_efs", "tmp"))).mode),
        0o777,
      );
      assert.equal(
        await readFile(
          path.join(root, "sbx_efs", "secrets", "controller-token"),
          "utf8",
        ),
        "ntok_test\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
