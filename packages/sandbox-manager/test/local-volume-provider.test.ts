import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalVolumeProvider } from "../src/storage/local-volume-provider.js";

function mode(value: number): number {
  return value & 0o777;
}

describe("LocalVolumeProvider", () => {
  it("removes local runtime directories when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-volumes-rm-"));
    try {
      const provider = new LocalVolumeProvider(root);
      await provider.materialize("sbx_remove", {
        configYaml: "version: 1\n",
        controllerToken: "ntok_test",
      });
      await provider.remove("sbx_remove", { removeVolumes: true });
      await assert.rejects(() => stat(path.join(root, "sbx_remove")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses privileged cleanup for sandbox-owned protected state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nerve-volumes-rm-"));
    const base = path.join(root, "sbx_protected");
    const protectedDir = path.join(base, "state", "credentials");
    let cleanupPath: string | undefined;
    try {
      await mkdir(protectedDir, { recursive: true });
      await writeFile(path.join(protectedDir, "credential.json"), "secret");
      await chmod(protectedDir, 0o000);
      const provider = new LocalVolumeProvider(root, async (target) => {
        cleanupPath = target;
        await chmod(protectedDir, 0o700);
        await rm(protectedDir, { recursive: true, force: true });
      });

      await provider.remove("sbx_protected", { removeVolumes: true });

      assert.equal(cleanupPath, base);
      await assert.rejects(() => stat(base));
    } finally {
      await chmod(protectedDir, 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

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
