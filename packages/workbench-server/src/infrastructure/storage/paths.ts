import { homedir } from "node:os";
import { join } from "node:path";

export interface StoragePaths {
  home: string;
  /** The operating system user's home directory (not the Nerve data dir). */
  userHome: string;
  daemonPath: string;
  sqlitePath: string;
  payloadsPath: string;
  localTokenPath: string;
  migrationsPath: string;
  migrationLedgerPath: string;
}

export function resolveDataDir(explicitHome = process.env.NERVE_HOME): string {
  return explicitHome && explicitHome.trim().length > 0
    ? explicitHome
    : join(homedir(), ".nerve");
}

export function storagePaths(home = resolveDataDir()): StoragePaths {
  return {
    home,
    userHome: homedir(),
    daemonPath: join(home, "daemon.json"),
    sqlitePath: join(home, "state.sqlite"),
    payloadsPath: join(home, "payloads"),
    localTokenPath: join(home, "auth", "local-token"),
    migrationsPath: join(home, "migrations"),
    migrationLedgerPath: join(home, "migrations", "ledger.json"),
  };
}
