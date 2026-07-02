import path from "node:path";

export type SandboxRuntimePaths = {
  stateDir: string;
  workspaceDir: string;
  configDir: string;
  credentialsDir: string;
  secretCacheDir: string;
  dependencyCacheDir: string;
};

export function resolveSandboxRuntimePaths(
  env = process.env,
): SandboxRuntimePaths {
  const stateDir = env.NERVE_SANDBOX_STATE_DIR?.trim() || "/state";
  const workspaceDir = env.NERVE_SANDBOX_WORKSPACE_DIR?.trim() || "/workspace";
  return {
    stateDir,
    workspaceDir,
    configDir: path.join(stateDir, "config"),
    credentialsDir: path.join(stateDir, "credentials"),
    secretCacheDir: path.join(stateDir, "cache", "secrets"),
    dependencyCacheDir: path.join(stateDir, "cache", "dependencies"),
  };
}

export function stateSubdirectories(paths: SandboxRuntimePaths): string[] {
  return [
    paths.configDir,
    path.join(paths.stateDir, "controller"),
    paths.credentialsDir,
    path.join(paths.credentialsDir, "oauth"),
    path.join(paths.credentialsDir, "ssh"),
    path.join(paths.credentialsDir, "gpg"),
    path.join(paths.stateDir, "secrets"),
    path.join(paths.stateDir, "setup"),
    path.join(paths.stateDir, "commands"),
    path.join(paths.stateDir, "events"),
    path.join(paths.stateDir, "conversations"),
    path.join(paths.stateDir, "skills"),
    path.join(paths.stateDir, "boot"),
    paths.dependencyCacheDir,
    paths.secretCacheDir,
    path.join(paths.stateDir, "tmp"),
  ];
}
