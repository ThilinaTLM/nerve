import { homedir } from "node:os";
import { join } from "node:path";

export interface StoragePaths {
  home: string;
  configPath: string;
  providersPath: string;
  daemonPath: string;
  sqlitePath: string;
  localTokenPath: string;
}

export function resolveDataDir(explicitHome = process.env.NERVE_HOME): string {
  return explicitHome && explicitHome.trim().length > 0
    ? explicitHome
    : join(homedir(), ".nerve");
}

export function storagePaths(home = resolveDataDir()): StoragePaths {
  return {
    home,
    configPath: join(home, "config.json"),
    providersPath: join(home, "providers.json"),
    daemonPath: join(home, "daemon.json"),
    sqlitePath: join(home, "state.sqlite"),
    localTokenPath: join(home, "auth", "local-token"),
  };
}
