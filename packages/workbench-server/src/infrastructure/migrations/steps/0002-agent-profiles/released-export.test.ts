import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareExport,
  applyExport,
  verifyExport,
  rollbackExport,
  retireExportSources,
  exportedTarget,
  convertedTrust,
  type ExportIO,
} from "./released-export.js";
import { sha256 } from "./released-format.js";
function memory() {
  const files = new Map<string, string>([["/source", '{"version":3}\n']]);
  const io: ExportIO = {
    read: (path) => files.get(path),
    write: (path, bytes) => {
      files.set(path, bytes);
    },
    remove: (path) => {
      files.delete(path);
    },
  };
  return { files, io };
}
function proposed(io: ExportIO) {
  return prepareExport(io, {
    identity: "fixture",
    backupDirectory: "/protected",
    sources: ["/source"],
    targets: {
      "/target": exportedTarget("preferences", {
        schemaVersion: 1,
        revision: 0,
        overrides: {},
      }),
    },
    rowDigest: sha256("released row"),
    retire: ["/source"],
  });
}

await test("exports, verifies every candidate, retires only after commit and restores exact originals", () => {
  const { io, files } = memory();
  const receipt = proposed(io);
  applyExport(io, "/receipt", receipt);
  verifyExport(io, receipt, receipt.rowDigest);
  assert(files.has("/source"));
  retireExportSources(io, receipt);
  assert(!files.has("/source"));
  rollbackExport(io, receipt);
  assert.equal(files.get("/source"), '{"version":3}\n');
  assert(!files.has("/target"));
  assert(files.has(receipt.sources["/source"].backup));
});

await test("interruption after each backup, receipt and output write resumes without unowned overwrites", () => {
  for (let failAfter = 1; failAfter <= 3; failAfter++) {
    const { io, files } = memory();
    const receipt = proposed(io);
    let count = 0;
    const interrupted: ExportIO = {
      ...io,
      write(path, bytes) {
        io.write(path, bytes);
        if (++count === failAfter) throw new Error("crash");
      },
    };
    assert.throws(() => applyExport(interrupted, "/receipt", receipt), /crash/);
    applyExport(io, "/receipt", receipt);
    verifyExport(io, receipt, receipt.rowDigest);
    assert.equal(files.get("/target"), receipt.targets["/target"].bytes);
  }
});

await test("post-export/pre-commit retry rechecks rows, targets, original backups and changed sources", () => {
  const { io, files } = memory();
  const receipt = proposed(io);
  applyExport(io, "/receipt", receipt);
  assert.throws(
    () => verifyExport(io, receipt, sha256("changed row")),
    /row changed/,
  );
  files.set("/target", "external edit");
  assert.throws(
    () => applyExport(io, "/receipt", receipt),
    /collision or later edit/,
  );
  assert.throws(
    () => verifyExport(io, receipt, receipt.rowDigest),
    /changed export/,
  );
  assert.throws(() => rollbackExport(io, receipt), /later edit/);
  assert.equal(files.get("/source"), '{"version":3}\n');
  files.set("/target", receipt.targets["/target"].bytes);
  files.set(receipt.sources["/source"].backup, "changed backup");
  assert.throws(
    () => verifyExport(io, receipt, receipt.rowDigest),
    /protected original/,
  );
});

await test("preexisting identical target is a collision without a durable receipt; invalid export blocks planning", () => {
  const { io, files } = memory();
  const receipt = proposed(io);
  files.set("/target", receipt.targets["/target"].bytes);
  assert.throws(() => proposed(io), /collision/);
  assert.throws(() => applyExport(io, "/receipt", receipt), /collision/);
  assert.throws(() =>
    exportedTarget("preferences", {
      schemaVersion: 2,
      revision: 0,
      overrides: {},
    }),
  );
  assert(!files.has("/receipt"));
});

await test("source-bound trust grants converted bytes only for exact trusted originals", () => {
  const source = { path: "/project/capabilities", digest: sha256("original") };
  const original = {
    path: source.path,
    kind: "project_capabilities",
    contentDigest: source.digest,
    status: "trusted" as const,
  };
  assert.equal(
    convertedTrust(
      [original],
      [source],
      "/project/agent",
      sha256("new"),
      "project_capabilities",
    ).status,
    "trusted",
  );
  assert.equal(
    convertedTrust(
      [{ ...original, status: "rejected" }],
      [source],
      "/project/agent",
      sha256("new"),
      "project_capabilities",
    ).status,
    "rejected",
  );
  assert.equal(
    convertedTrust(
      [original],
      [{ ...source, digest: sha256("edit") }],
      "/project/agent",
      sha256("new"),
      "project_capabilities",
    ).status,
    "rejected",
  );
  assert.equal(
    convertedTrust(
      [original],
      [source, { path: "/untrusted", digest: sha256("untrusted") }],
      "/profile",
      sha256("new"),
      "agent_profile",
    ).status,
    "rejected",
  );
});
