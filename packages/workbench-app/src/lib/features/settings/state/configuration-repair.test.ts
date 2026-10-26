import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  RepairApplyRequest,
  RepairPreview,
} from "@nervekit/contracts/agent-configuration";
import { ConfigurationRepair } from "./configuration-repair";
const preview: RepairPreview = {
  target: {
    document: "agent",
    scope: { scope: "project", projectId: "project-one" },
  },
  sourceDigest: "original",
  candidateDigest: "replacement",
  candidateVersion: 1,
  candidate: { schemaVersion: 1, revision: 3, overrides: {} },
  changedPaths: ["/overrides"],
  resolution: { settings: {}, provenance: {}, diagnostics: [] },
};
const input = { target: preview.target, replacement: preview.candidate };
const saved = {
  status: "saved" as const,
  digest: preview.candidateDigest,
  backupPath: "backup",
  receiptPath: "receipt",
  durability: "synchronized" as const,
};
test("preview and dismissal never apply; editing invalidates confirmation", async () => {
  let writes = 0;
  const session = new ConfigurationRepair(
    {
      preview: async () => ({ status: "ready", preview }),
      apply: async () => {
        writes++;
        return saved;
      },
    },
    () => {},
  );
  await session.preview(input);
  assert.equal(writes, 0);
  session.dismiss();
  assert.equal(await session.apply(), false);
  await session.preview(input);
  session.edited();
  assert.equal(await session.apply(), false);
  assert.equal(writes, 0);
});
test("a dismissed in-flight preview cannot restore repair authorization", async () => {
  let resolve!: (value: { status: "ready"; preview: RepairPreview }) => void;
  let writes = 0;
  const session = new ConfigurationRepair(
    {
      preview: () =>
        new Promise((ready) => {
          resolve = ready;
        }),
      apply: async () => {
        writes++;
        return saved;
      },
    },
    () => {},
  );
  const pending = session.preview(input);
  session.dismiss();
  resolve({ status: "ready", preview });
  await pending;
  assert.equal(session.state.preview, undefined);
  assert.equal(await session.apply(), false);
  assert.equal(writes, 0);
});
test("uncertain apply retries the exact source-bound confirmation for receipt reconciliation", async () => {
  const requests: RepairApplyRequest[] = [];
  const session = new ConfigurationRepair(
    {
      preview: async () => ({ status: "ready", preview }),
      apply: async (request) => {
        requests.push(request);
        if (requests.length === 1) throw new Error("Connection lost");
        return saved;
      },
    },
    () => {},
  );
  await session.preview(input);
  assert.equal(await session.apply(), false);
  assert.match(session.state.error!, /receipt/);
  assert.equal(await session.apply(), true);
  assert.equal(requests[0], requests[1]);
  assert.deepEqual(requests[0], {
    target: preview.target,
    sourceDigest: "original",
    candidateDigest: "replacement",
    candidateVersion: 1,
    candidate: preview.candidate,
  });
  assert.equal(session.state.result?.receiptPath, "receipt");
  assert.equal(await session.apply(), false);
  assert.equal(requests.length, 2);
});
test("conflict clears authorization rather than silently confirming a new candidate", async () => {
  let writes = 0;
  const session = new ConfigurationRepair(
    {
      preview: async () => ({ status: "ready", preview }),
      apply: async () => {
        writes++;
        return { status: "conflict", diagnostics: [] };
      },
    },
    () => {},
  );
  await session.preview(input);
  assert.equal(await session.apply(), false);
  assert.equal(session.state.preview, undefined);
  assert.equal(await session.apply(), false);
  assert.equal(writes, 1);
});
