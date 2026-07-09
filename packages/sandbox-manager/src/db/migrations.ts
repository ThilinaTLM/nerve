import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { StructuredLogger } from "@nervekit/shared";
import { runner } from "node-pg-migrate";
import pg from "pg";
import {
  loadManagerConfig,
  type ManagerConfig,
} from "../config/manager-config.js";

const { Client } = pg;

type MigrationDirection = "up" | "down";

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

export async function runMigrations(
  config: ManagerConfig,
  logger?: StructuredLogger,
  direction: MigrationDirection = "up",
): Promise<void> {
  if (!config.databaseUrl)
    throw new Error(
      "NERVE_SANDBOX_MANAGER_DATABASE_URL or DATABASE_URL is required for sandbox-manager storage",
    );

  const client = new Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    await client.query("create schema if not exists manager");
    const applied = await runner({
      dbClient: client,
      direction,
      dir: migrationsDir,
      migrationsTable: "schema_migrations",
      migrationsSchema: "manager",
      schema: ["manager", "sandbox", "identity"],
      createSchema: true,
      singleTransaction: true,
      checkOrder: true,
      log: (message) => {
        if (logger) logger.info("database migration", { message });
        else console.info(message);
      },
    });
    logger?.info("database migrations complete", {
      direction,
      applied: applied.map((migration) => migration.name),
    });
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const direction = process.argv[2] === "down" ? "down" : "up";
  runMigrations(loadManagerConfig(), undefined, direction).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
