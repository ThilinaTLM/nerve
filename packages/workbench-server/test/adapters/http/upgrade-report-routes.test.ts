import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { createUpgradeReportRoutes } from "../../../src/adapters/http/routes/upgrade-report-routes.js";

const report = (step: string) => ({
  step,
  description: "Conversation core",
  completedAt: "2026-01-01T00:00:00.000Z",
  setAside: [
    {
      kind: "conversation",
      id: "c1",
      reason: "broken",
      quarantinePath: "/q/c1",
    },
  ],
  losses: [{ reason: "missing asset", count: 2 }],
});

test("lists unseen reports, ignores malformed ones, and dismisses", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "upgrade-reports-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, "migrations", "reports");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "0001-a.json"), JSON.stringify(report("0001-a")));
  await writeFile(join(dir, "0002-b.json"), JSON.stringify(report("0002-b")));
  await writeFile(join(dir, "0002-b.seen"), "");
  await writeFile(join(dir, "0003-c.json"), "{truncated");
  await writeFile(join(dir, "0004-d.json"), JSON.stringify({ step: "x" }));
  const app = new Hono().route(
    "/api",
    createUpgradeReportRoutes({
      storage: { paths: { migrationReportsPath: dir } },
    } as never),
  );

  const list = await app.request("/api/storage/upgrade-reports");
  const body = (await list.json()) as { reports: { step: string }[] };
  assert.deepEqual(
    body.reports.map((r) => r.step),
    ["0001-a"],
  );

  assert.equal(
    (
      await app.request("/api/storage/upgrade-reports/..%2Fx/dismiss", {
        method: "POST",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request("/api/storage/upgrade-reports/0009-none/dismiss", {
        method: "POST",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await app.request("/api/storage/upgrade-reports/0001-a/dismiss", {
        method: "POST",
      })
    ).status,
    200,
  );
  assert.ok(existsSync(join(dir, "0001-a.seen")));
  const after = (await (
    await app.request("/api/storage/upgrade-reports")
  ).json()) as { reports: unknown[] };
  assert.deepEqual(after.reports, []);
});

test("missing reports directory yields an empty list", async () => {
  const app = new Hono().route(
    "/api",
    createUpgradeReportRoutes({
      storage: { paths: { migrationReportsPath: "/nonexistent/reports" } },
    } as never),
  );
  const res = await app.request("/api/storage/upgrade-reports");
  assert.deepEqual(await res.json(), { reports: [] });
});
