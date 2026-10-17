import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  upgradeReportSchema,
  upgradeStepIdSchema,
  type UpgradeReport,
} from "@nervekit/contracts/status";
import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type UpgradeReportRoutesContext =
  ServerAdapterContexts["http"]["upgradeReports"];

/** Unseen upgrade reports; unreadable or malformed files are ignored. */
export async function readUnseenUpgradeReports(
  directory: string,
): Promise<UpgradeReport[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const seen = new Set(names.filter((n) => n.endsWith(".seen")));
  const reports: UpgradeReport[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const step = name.slice(0, -".json".length);
    if (!upgradeStepIdSchema.safeParse(step).success) continue;
    if (seen.has(`${step}.seen`)) continue;
    try {
      const parsed = upgradeReportSchema.safeParse(
        JSON.parse(await readFile(join(directory, name), "utf8")),
      );
      if (parsed.success && parsed.data.step === step) {
        reports.push(parsed.data);
      }
    } catch {
      // A damaged report must never affect the workbench.
    }
  }
  return reports;
}

export function createUpgradeReportRoutes(
  state: UpgradeReportRoutesContext,
): Hono {
  const app = new Hono();
  const directory = () => state.storage.paths.migrationReportsPath;

  app.get("/storage/upgrade-reports", async (c) =>
    c.json({ reports: await readUnseenUpgradeReports(directory()) }),
  );

  app.post("/storage/upgrade-reports/:step/dismiss", async (c) => {
    const step = c.req.param("step");
    if (!upgradeStepIdSchema.safeParse(step).success) {
      return c.json({ error: "Invalid upgrade step id." }, 400);
    }
    try {
      await readFile(join(directory(), `${step}.json`));
    } catch {
      return c.json({ error: "Upgrade report not found." }, 404);
    }
    await writeFile(join(directory(), `${step}.seen`), "", { mode: 0o600 });
    return c.json({ ok: true });
  });

  return app;
}
