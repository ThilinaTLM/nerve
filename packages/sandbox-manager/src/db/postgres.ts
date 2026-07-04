import pg from "pg";
import type { ManagerConfig } from "../config/manager-config.js";

const { Pool } = pg;

export type PostgresPool = pg.Pool;

export function createPostgresPool(config: ManagerConfig): PostgresPool {
  if (!config.databaseUrl)
    throw new Error(
      "NERVE_SANDBOX_MANAGER_DATABASE_URL or DATABASE_URL is required for sandbox-manager storage",
    );
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
}
