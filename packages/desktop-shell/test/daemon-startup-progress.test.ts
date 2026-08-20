import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DaemonStartupProgress } from "@nervekit/contracts";
import { DaemonStartupProgressDecoder } from "../src/daemon/startup-progress.js";

describe("daemon startup progress", () => {
  it("decodes fragmented progress lines and ignores ordinary daemon output", () => {
    const received: DaemonStartupProgress[] = [];
    const decoder = new DaemonStartupProgressDecoder((progress) =>
      received.push(progress),
    );

    decoder.push("ordinary stderr\nNERVE_STARTUP_PRO");
    decoder.push(
      'GRESS {"type":"nerve.startup.progress","kind":"progress","phase":"storage-migration",',
    );
    decoder.push('"message":"Upgrading workspace storage"}\n');

    assert.deepEqual(received, [
      {
        type: "nerve.startup.progress",
        kind: "progress",
        phase: "storage-migration",
        message: "Upgrading workspace storage",
      },
    ]);
  });

  it("ignores malformed and unsupported progress payloads", () => {
    const received: DaemonStartupProgress[] = [];
    const decoder = new DaemonStartupProgressDecoder((progress) =>
      received.push(progress),
    );

    decoder.push("NERVE_STARTUP_PROGRESS not-json\n");
    decoder.push(
      'NERVE_STARTUP_PROGRESS {"type":"other","phase":"storage-check","message":"No"}\n',
    );

    assert.deepEqual(received, []);
  });
});
