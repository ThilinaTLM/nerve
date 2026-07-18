import path from "node:path";

export type SandboxRuntimePaths = {
  stateDir: string;
  workspaceDir: string;
  configDir: string;
  controllerDir: string;
  credentialsDir: string;
  credentialsOAuthDir: string;
  credentialsSshDir: string;
  credentialsGpgDir: string;
  secretsDir: string;
  setupDir: string;
  eventsDir: string;
  conversationsDir: string;
  skillsDir: string;
  bootDir: string;
  cacheDir: string;
  secretCacheDir: string;
  dependencyCacheDir: string;
  pnpmHomeDir: string;
  npmCacheDir: string;
  npmGlobalDir: string;
  yarnCacheDir: string;
  tmpDir: string;
};

export function resolveSandboxRuntimePaths(
  env = process.env,
): SandboxRuntimePaths {
  const stateDir = env.NERVE_SANDBOX_AGENT_STATE_DIR?.trim() || "/state";
  const workspaceDir =
    env.NERVE_SANDBOX_AGENT_WORKSPACE_DIR?.trim() || "/workspace";
  const cacheDir = path.join(stateDir, "cache");
  const dependencyCacheDir = path.join(cacheDir, "dependencies");
  const credentialsDir = path.join(stateDir, "credentials");
  return {
    stateDir,
    workspaceDir,
    configDir: path.join(stateDir, "config"),
    controllerDir: path.join(stateDir, "controller"),
    credentialsDir,
    credentialsOAuthDir: path.join(credentialsDir, "oauth"),
    credentialsSshDir: path.join(credentialsDir, "ssh"),
    credentialsGpgDir: path.join(credentialsDir, "gpg"),
    secretsDir: path.join(stateDir, "secrets"),
    setupDir: path.join(stateDir, "setup"),
    eventsDir: path.join(stateDir, "events"),
    conversationsDir: path.join(stateDir, "conversations"),
    skillsDir: path.join(stateDir, "skills"),
    bootDir: path.join(stateDir, "boot"),
    cacheDir,
    dependencyCacheDir,
    pnpmHomeDir: path.join(dependencyCacheDir, "pnpm"),
    npmCacheDir: path.join(dependencyCacheDir, "npm"),
    npmGlobalDir: path.join(dependencyCacheDir, "npm-global"),
    yarnCacheDir: path.join(dependencyCacheDir, "yarn"),
    secretCacheDir: path.join(cacheDir, "secrets"),
    tmpDir: path.join(stateDir, "tmp"),
  };
}

export function stateSubdirectories(paths: SandboxRuntimePaths): string[] {
  return [
    paths.configDir,
    paths.controllerDir,
    paths.credentialsDir,
    paths.credentialsOAuthDir,
    paths.credentialsSshDir,
    paths.credentialsGpgDir,
    paths.secretsDir,
    paths.setupDir,
    paths.eventsDir,
    paths.conversationsDir,
    paths.skillsDir,
    paths.bootDir,
    paths.cacheDir,
    paths.dependencyCacheDir,
    paths.pnpmHomeDir,
    paths.npmCacheDir,
    paths.npmGlobalDir,
    paths.yarnCacheDir,
    paths.secretCacheDir,
    paths.tmpDir,
  ];
}

export function initialStateFiles(paths: SandboxRuntimePaths): string[] {
  return [
    path.join(paths.configDir, "digest.txt"),
    path.join(paths.configDir, "effective.json"),
    path.join(paths.configDir, "sanitized.json"),
    path.join(paths.configDir, "sanitized.yaml"),
    path.join(paths.controllerDir, "session.json"),
    path.join(paths.controllerDir, "cursors.json"),
    path.join(paths.controllerDir, "connectivity.json"),
    path.join(paths.credentialsDir, "status.json"),
    path.join(paths.secretsDir, "stores.json"),
    path.join(paths.secretsDir, "status.json"),
    path.join(paths.setupDir, "git.json"),
    path.join(paths.setupDir, "github.json"),
    path.join(paths.controllerDir, "idempotency", "records.jsonl"),
    path.join(paths.controllerDir, "idempotency", "conflicts.jsonl"),
    path.join(paths.eventsDir, "outbox.jsonl"),
    path.join(paths.eventsDir, "meta.json"),
    path.join(paths.skillsDir, "context-files.json"),
    path.join(paths.skillsDir, "loaded.json"),
    path.join(paths.skillsDir, "diagnostics.jsonl"),
    path.join(paths.bootDir, "attempts.jsonl"),
    path.join(paths.bootDir, "latest.log"),
  ];
}

export function runStateDirectory(
  paths: SandboxRuntimePaths,
  conversationId: string,
  agentId: string,
  runId: string,
): string {
  return path.join(
    paths.conversationsDir,
    conversationId,
    "agents",
    agentId,
    "runs",
    runId,
  );
}
