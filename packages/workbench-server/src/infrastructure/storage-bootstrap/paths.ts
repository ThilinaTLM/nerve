import { homedir } from "node:os";
import { join } from "node:path";

export interface StoragePaths {
  home: string;
  /** The operating system user's home directory (not the Nerve home). */
  userHome: string;
  manifestPath: string;
  daemonPath: string;
  configPath: string;
  daemonConfigPath: string;
  harnessConfigPath: string;
  uiConfigPath: string;
  permissionsConfigPath: string;
  providersConfigPath: string;
  integrationsConfigPath: string;
  secretsPath: string;
  masterKeyPath: string;
  credentialsPath: string;
  localTokenPath: string;
  dataPath: string;
  sqlitePath: string;
  idempotencyPath: string;
  maintenancePath: string;
  storageCleanupOperationPath: string;
  payloadsPath: string;
  reportsPath: string;
  imagesPath: string;
  plansPath: string;
  tasksPath: string;
  agentPath: string;
  suggestionsPath: string;
  tlsPath: string;
  tmpPath: string;
  cachePath: string;
  queryCachePath: string;
  logsPath: string;
  crashesPath: string;
  migrationsPath: string;
  migrationLedgerPath: string;
  backupsPath: string;
}

export function resolveDataDir(explicitHome = process.env.NERVE_HOME): string {
  return explicitHome && explicitHome.trim().length > 0
    ? explicitHome
    : join(homedir(), ".nerve");
}

export function storagePaths(home = resolveDataDir()): StoragePaths {
  const configPath = join(home, "config");
  const secretsPath = join(home, "secrets");
  const dataPath = join(home, "data");
  const agentPath = join(home, "agent");
  const maintenancePath = join(dataPath, "maintenance");
  const migrationsPath = join(home, "migrations");
  const cachePath = join(home, "cache");
  return {
    home,
    userHome: homedir(),
    manifestPath: join(home, "manifest.json"),
    daemonPath: join(home, "daemon.json"),
    configPath,
    daemonConfigPath: join(configPath, "daemon.json"),
    harnessConfigPath: join(configPath, "harness.json"),
    uiConfigPath: join(configPath, "ui.json"),
    permissionsConfigPath: join(configPath, "permissions.json"),
    providersConfigPath: join(configPath, "providers.json"),
    integrationsConfigPath: join(configPath, "integrations.json"),
    secretsPath,
    masterKeyPath: join(secretsPath, "master.key"),
    credentialsPath: join(secretsPath, "credentials.enc"),
    localTokenPath: join(secretsPath, "daemon-token"),
    dataPath,
    sqlitePath: join(dataPath, "nerve.sqlite"),
    idempotencyPath: join(dataPath, "idempotency"),
    maintenancePath,
    storageCleanupOperationPath: join(maintenancePath, "storage-cleanup.json"),
    payloadsPath: join(dataPath, "payloads"),
    reportsPath: join(dataPath, "reports"),
    imagesPath: join(dataPath, "images"),
    plansPath: join(dataPath, "plans"),
    tasksPath: join(home, "tasks"),
    agentPath,
    suggestionsPath: join(agentPath, "suggestions"),
    tlsPath: join(home, "tls"),
    tmpPath: join(home, "tmp"),
    cachePath,
    queryCachePath: join(cachePath, "query-cache.sqlite"),
    logsPath: join(home, "logs"),
    crashesPath: join(home, "crashes"),
    migrationsPath,
    migrationLedgerPath: join(migrationsPath, "ledger.json"),
    backupsPath: join(home, "backups"),
  };
}
