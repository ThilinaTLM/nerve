import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoreStorage } from "@nervekit/conversation-core";
import {
  ReleasedProjectMigration,
  type ProjectMigrationOptions,
} from "./released-project.js";
import { commitProjectTrust } from "./released-project-trust.js";
import { sha256, jsonBytes } from "./released-format.js";
import type { OriginalTrust } from "./released-export.js";

function fixture(trusted = true) {
  const source = "/project/.nerve/config/capabilities.json",
    target = "/project/.nerve/config/agent.json";
  const bytes = jsonBytes({
    schemaVersion: 2,
    tools: { jira: { enabled: true } },
  });
  const files = new Map([
    [source, bytes],
    [
      "/home/config/agent.json",
      jsonBytes({
        schemaVersion: 1,
        revision: 0,
        overrides: { tools: { jira: { profileId: "account" } } },
      }),
    ],
  ]);
  const records = new Map<string, OriginalTrust>([
    [
      "original",
      {
        id: "original",
        kind: "project_capabilities",
        projectId: "p",
        path: source,
        name: "original",
        contentDigest: sha256(bytes),
        status: trusted ? "trusted" : "rejected",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);
  let failMarker = false,
    discoveries = 0;
  const reports: string[][] = [];
  const repository = {
    get: (id: string) => records.get(id) ?? null,
    find: (kind: string, projectId: string, path: string) =>
      [...records.values()].find(
        (row) =>
          row.kind === kind && row.projectId === projectId && row.path === path,
      ) ?? null,
    insert: (row: OriginalTrust) => {
      records.set(row.id!, row);
      return row;
    },
    delete: (id: string) => {
      records.delete(id);
    },
  };
  const storage = {
    trustedResources: repository,
    transaction<T>(run: () => T) {
      const before = new Map(records);
      try {
        return run();
      } catch (error) {
        records.clear();
        for (const [id, row] of before) records.set(id, row);
        throw error;
      }
    },
  } as unknown as Pick<CoreStorage, "transaction" | "trustedResources">;
  const options: ProjectMigrationOptions = {
    home: "/home",
    directory: () => "/project",
    io: {
      read: (path) => files.get(path),
      write(path, bytes) {
        if (failMarker && path.endsWith("committed.json")) {
          failMarker = false;
          throw new Error("crash after trust commit");
        }
        files.set(path, bytes);
      },
      remove: (path) => {
        files.delete(path);
      },
    },
    async discover() {
      discoveries++;
      return {};
    },
    originalTrust: () => [...records.values()],
    commitTrust: (id, original, decisions, createdAt) =>
      commitProjectTrust(storage, id, original, decisions, createdAt),
    report: (_id, messages) => {
      reports.push(messages);
    },
  };
  return {
    options,
    source,
    target,
    files,
    records,
    reports,
    discoveries: () => discoveries,
    crashAtMarker: () => {
      failMarker = true;
    },
  };
}
await test("first-use conversion uses registered converters, preserves trust and publishes D9 fields without a global ledger claim", async () => {
  const f = fixture();
  const migration = new ReleasedProjectMigration(f.options);
  await Promise.all([migration.ensure("p"), migration.ensure("p")]);
  assert.equal(f.discoveries(), 1);
  assert(!f.files.has(f.source));
  assert(f.files.has(f.target));
  assert(
    f.reports
      .flat()
      .some(
        (message) =>
          message.includes(f.source) &&
          message.includes("/tools/jira/profileId"),
      ),
  );
  assert(f.reports.flat().some((message) => message.includes("Re-granted")));
  const record = [...f.records.values()][0];
  assert.equal(record.path, f.target);
  assert.equal(record.status, "trusted");
  assert(![...f.files.keys()].some((path) => path.includes("ledger")));
  const changed = jsonBytes({
    schemaVersion: 1,
    revision: 1,
    overrides: { reasoningLevel: "high" },
  });
  f.files.set(f.target, changed);
  await new ReleasedProjectMigration(f.options).ensure("p");
  assert.equal(f.files.get(f.target), changed);
});
await test("a crash after project trust commit retries idempotently before retiring sources", async () => {
  const f = fixture();
  const migration = new ReleasedProjectMigration(f.options);
  f.crashAtMarker();
  await assert.rejects(migration.ensure("p"), /crash/);
  assert(f.files.has(f.source));
  assert.equal(f.records.size, 1);
  migration.retry("p");
  await migration.ensure("p");
  assert(!f.files.has(f.source));
  assert.equal(f.records.size, 1);
});
await test("untrusted project input stays untrusted; duplicate targets are never overwritten", async () => {
  const f = fixture(false);
  await new ReleasedProjectMigration(f.options).ensure("p");
  assert.equal([...f.records.values()][0].status, "rejected");
  const collision = fixture();
  collision.files.set(collision.target, "external edit");
  const migration = new ReleasedProjectMigration(collision.options);
  await assert.rejects(migration.ensure("p"), /collision/);
  assert.equal(collision.files.get(collision.target), "external edit");
  assert(collision.files.has(collision.source));
  await assert.rejects(migration.ensure("p"), /collision/);
  assert.equal(collision.discoveries(), 1);
});
await test("planning policy selectors retain exact-source project trust without creating missing preferences", async () => {
  for (const trusted of [true, false]) {
    const f = fixture(trusted);
    f.files.delete(f.source);
    const path = "/project/.nerve/config/permissions.json";
    const bytes = jsonBytes({
      schemaVersion: 2,
      overlays: [
        {
          ruleSetId: "planning",
          rules: [
            {
              id: "plan",
              enabled: true,
              priority: 0,
              enforcement: "overridable",
              when: { toolNames: ["plan_mode_present"] },
              decision: "deny",
            },
          ],
        },
      ],
    });
    f.files.set(path, bytes);
    const original = f.records.get("original")!;
    f.records.set("original", {
      ...original,
      kind: "project_permissions",
      path,
      contentDigest: sha256(bytes),
    });
    f.crashAtMarker();
    const migration = new ReleasedProjectMigration(f.options);
    await assert.rejects(migration.ensure("p"), /crash/);
    migration.retry("p");
    await migration.ensure("p");
    assert(!f.files.has(f.target));
    assert(f.files.get(path)!.includes('"plan_present"'));
    const record = [...f.records.values()][0];
    assert.equal(record.kind, "project_permissions");
    assert.equal(record.path, path);
    assert.equal(record.contentDigest, sha256(f.files.get(path)!));
    assert.equal(record.status, trusted ? "trusted" : "rejected");
  }
});
