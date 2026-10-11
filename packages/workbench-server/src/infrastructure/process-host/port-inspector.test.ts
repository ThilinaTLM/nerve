import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import type { LaunchRuntime } from "@nervekit/contracts/launches";
import {
  inspectConfiguredPort,
  inspectRuntimeListeningPorts,
  isSameProcessIdentity,
} from "./port-inspector.js";

function runtime(): LaunchRuntime {
  return {
    version: 2,
    containment: process.platform === "win32" ? "job-object" : "process-group",
    identity: { kind: "linux", startTimeTicks: 0 },
    capabilities: { identity: true, processTree: true, listeningPorts: true },
    platform: process.platform,
    childPid: process.pid,
    detached: process.platform !== "win32",
    shell: true,
    spawnedAt: new Date().toISOString(),
  };
}

void describe("launch port inspector", () => {
  void it("detects current-process TCP listeners on supported hosts", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const ports = await inspectRuntimeListeningPorts(runtime());
      if (
        !(["linux", "darwin", "win32"] as NodeJS.Platform[]).includes(
          process.platform,
        )
      ) {
        assert.deepEqual(ports, []);
        return;
      }
      assert.ok(
        ports.some(
          (port) =>
            port.protocol === "tcp" &&
            port.address === "127.0.0.1" &&
            port.port === address.port &&
            port.pid === process.pid,
        ),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  void it("reports configured-port conflicts with a stable process identity", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const listeners = await inspectConfiguredPort(address.port);
      const listener = listeners.find((item) => item.pid === process.pid);
      assert.ok(listener);
      assert.equal(listener.port, address.port);
      assert.ok(listener.identity.length > 0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  void it("requires PID identity before considering two listeners the same process", () => {
    const base = {
      protocol: "tcp" as const,
      address: "127.0.0.1",
      port: 3000,
      pid: 1234,
      processGroupId: 1234,
      processStartTimeTicks: 100,
      detectedAt: "2026-01-02T03:04:05.000Z",
    };

    assert.equal(isSameProcessIdentity(base, { ...base }), true);
    assert.equal(isSameProcessIdentity(base, { ...base, pid: 4321 }), false);
    assert.equal(
      isSameProcessIdentity(base, {
        ...base,
        processStartTimeTicks: 101,
      }),
      false,
    );
  });
});
