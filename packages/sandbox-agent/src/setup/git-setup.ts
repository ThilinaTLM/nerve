import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  SandboxConfigV1,
  SandboxCredentialConfig,
  SandboxGitCredentialProfileConfig,
  SandboxSecretRef,
  StartupSetupStatus,
} from "@nervekit/shared";
import type { SecretResolver } from "../credentials/secret-resolver.js";

const execFileAsync = promisify(execFile);

type GitSetupOptions = {
  workspaceDir: string;
  stateDir: string;
  credentialsDir: string;
  resolver?: SecretResolver;
};

type GitSetupResult = StartupSetupStatus & { env?: Record<string, string> };

type MaterializedCredential = {
  name: string;
  protocol?: "https" | "ssh";
  host?: string;
  user?: string;
  username?: string;
  passwordFile?: string;
  sshKeyFile?: string;
  knownHostsFile?: string;
};

export async function runGitSetup(
  config: SandboxConfigV1,
  workspaceDirOrOptions: string | GitSetupOptions,
): Promise<GitSetupResult> {
  if (!config.git?.enabled) return { configured: false, status: "skipped" };
  const options =
    typeof workspaceDirOrOptions === "string"
      ? {
          workspaceDir: workspaceDirOrOptions,
          stateDir: "/state",
          credentialsDir: "/state/credentials",
        }
      : workspaceDirOrOptions;
  const startedAt = new Date().toISOString();
  const gitDir = path.join(options.stateDir, "git");
  const gitCredentialsDir = path.join(options.credentialsDir, "git");
  const globalConfig = path.join(gitDir, "config");
  const env = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: "0",
  };
  Object.assign(process.env, env);
  const limitations: string[] = [];
  try {
    await mkdir(gitDir, { recursive: true, mode: 0o700 });
    await mkdir(gitCredentialsDir, { recursive: true, mode: 0o700 });
    await writeFile(globalConfig, "", { flag: "a", mode: 0o600 });

    const credentials = await materializeCredentials(
      config,
      gitCredentialsDir,
      options.resolver,
    );
    await configureCredentialHelpers(
      credentials,
      gitCredentialsDir,
      options.workspaceDir,
      env,
    );

    const identity = config.git.identity;
    if (identity?.name)
      await git(
        ["config", "--global", "user.name", identity.name],
        options.workspaceDir,
        env,
      );
    if (identity?.email)
      await git(
        ["config", "--global", "user.email", identity.email],
        options.workspaceDir,
        env,
      );
    if (identity?.signCommits)
      await configureSigning(
        config,
        gitCredentialsDir,
        options.workspaceDir,
        env,
      );

    await configureSafeDirectory(config, options.workspaceDir, env);

    if (config.git.clone?.url) {
      await cloneRepository(config, options.workspaceDir, env);
    }

    await configureRemotes(config, options.workspaceDir, env);

    if (config.git.lfs) {
      await git(["lfs", "install", "--local"], options.workspaceDir, env).catch(
        (error) => {
          throw new Error(
            `Git LFS requested but unavailable or failed: ${errorMessage(error)}`,
          );
        },
      );
    }

    return {
      configured: true,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      env,
      limitations: limitations.length ? limitations : undefined,
    };
  } catch (error) {
    return {
      configured: true,
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      env,
      error: {
        code: "GIT_SETUP_FAILED",
        message: errorMessage(error),
      },
    };
  }
}

async function configureSafeDirectory(
  config: SandboxConfigV1,
  workspaceDir: string,
  env: Record<string, string>,
): Promise<void> {
  const safeDirectory = config.git?.safeDirectory ?? "workspace";
  if (safeDirectory === "none") return;
  const directories =
    safeDirectory === "workspace" ? [workspaceDir] : safeDirectory;
  for (const directory of directories)
    await git(
      ["config", "--global", "--add", "safe.directory", directory],
      workspaceDir,
      env,
    );
}

async function configureSigning(
  config: SandboxConfigV1,
  credentialsDir: string,
  workspaceDir: string,
  env: Record<string, string>,
): Promise<void> {
  const identity = config.git?.identity;
  if (!identity) return;
  await git(
    ["config", "--global", "commit.gpgsign", "true"],
    workspaceDir,
    env,
  );
  if (identity.signingFormat)
    await git(
      ["config", "--global", "gpg.format", identity.signingFormat],
      workspaceDir,
      env,
    );
  if (identity.signingKeyId)
    await git(
      ["config", "--global", "user.signingkey", identity.signingKeyId],
      workspaceDir,
      env,
    );
  if (identity.sshSigningKey) {
    const resolver = getResolver(config);
    const key = await resolver.resolve(identity.sshSigningKey);
    const keyFile = path.join(credentialsDir, "ssh-signing-key");
    await writeFile(keyFile, key, { mode: 0o600 });
    await git(
      ["config", "--global", "gpg.ssh.program", "ssh-keygen"],
      workspaceDir,
      env,
    );
    await git(
      ["config", "--global", "user.signingkey", keyFile],
      workspaceDir,
      env,
    );
  }
  if (identity.gpgPrivateKey)
    throw new Error(
      "OpenPGP signing keys are not supported by this sandbox agent image yet",
    );
}

async function cloneRepository(
  config: SandboxConfigV1,
  workspaceDir: string,
  env: Record<string, string>,
): Promise<void> {
  const clone = config.git?.clone;
  if (!clone?.url) return;
  assertCredentialReference(config, clone.credential);
  const targetDir = path.resolve(clone.targetDir ?? workspaceDir);
  assertWithinWorkspace(targetDir, workspaceDir);
  const nonEmpty = await isNonEmptyDirectory(targetDir);
  const policy = clone.ifWorkspaceNotEmpty ?? "skip";
  if (nonEmpty) {
    if (policy === "skip") return;
    if (policy === "fail")
      throw new Error(`Clone target is not empty: ${targetDir}`);
    await rm(targetDir, { recursive: true, force: true });
  }
  const args = ["clone"];
  if (clone.depth) args.push("--depth", String(clone.depth));
  if (clone.ref) args.push("--branch", clone.ref);
  if (clone.submodules) args.push("--recurse-submodules");
  args.push(clone.url, targetDir);
  await git(args, workspaceDir, env, 120_000);
}

async function configureRemotes(
  config: SandboxConfigV1,
  workspaceDir: string,
  env: Record<string, string>,
): Promise<void> {
  const remotes = config.git?.remotes ?? [];
  if (remotes.length === 0) return;
  if (!(await isGitRepository(workspaceDir, env))) return;
  for (const remote of remotes) {
    assertCredentialReference(config, remote.credential);
    const hasRemote = await git(
      ["remote", "get-url", remote.name],
      workspaceDir,
      env,
    )
      .then(() => true)
      .catch(() => false);
    if (hasRemote)
      await git(
        ["remote", "set-url", remote.name, remote.url],
        workspaceDir,
        env,
      );
    else
      await git(["remote", "add", remote.name, remote.url], workspaceDir, env);
    if (remote.pushUrl)
      await git(
        ["remote", "set-url", "--push", remote.name, remote.pushUrl],
        workspaceDir,
        env,
      );
  }
}

async function materializeCredentials(
  config: SandboxConfigV1,
  credentialsDir: string,
  resolver: SecretResolver | undefined,
): Promise<MaterializedCredential[]> {
  const entries: Array<[string, SandboxGitCredentialProfileConfig]> =
    Object.entries(config.git?.credentials ?? {});
  const clone = config.git?.clone;
  if (clone?.credential && typeof clone.credential !== "string") {
    entries.push([
      "clone",
      { match: gitMatchFromUrl(clone.url), credential: clone.credential },
    ]);
  }
  for (const [index, remote] of (config.git?.remotes ?? []).entries()) {
    if (remote.credential && typeof remote.credential !== "string") {
      entries.push([
        `remote_${index}_${remote.name}`,
        { match: gitMatchFromUrl(remote.url), credential: remote.credential },
      ]);
    }
  }
  const credentials: MaterializedCredential[] = [];
  for (const [name, profile] of entries) {
    const credential = profile.credential;
    if (credential.type === "ssh") {
      const key = await resolveSecret(config, resolver, credential.privateKey);
      const keyFile = path.join(credentialsDir, `${safe(name)}_id`);
      await writeFile(keyFile, key, { mode: 0o600 });
      let knownHostsFile: string | undefined;
      if (credential.knownHosts) {
        knownHostsFile = path.join(credentialsDir, `${safe(name)}_known_hosts`);
        await writeFile(
          knownHostsFile,
          await resolveSecret(config, resolver, credential.knownHosts),
          { mode: 0o600 },
        );
      }
      if (credential.passphrase)
        throw new Error(
          "Passphrase-protected SSH keys are not supported by this sandbox agent image yet",
        );
      credentials.push({
        name,
        protocol: profile.match?.protocol ?? "ssh",
        host: profile.match?.host,
        user: profile.match?.user,
        sshKeyFile: keyFile,
        knownHostsFile,
      });
      continue;
    }
    const materialized = await materializeHttpCredential(
      config,
      name,
      credential,
      credentialsDir,
      resolver,
    );
    credentials.push({
      name,
      protocol: profile.match?.protocol ?? "https",
      host: profile.match?.host,
      user: profile.match?.user,
      ...materialized,
    });
  }
  return credentials;
}

async function materializeHttpCredential(
  config: SandboxConfigV1,
  name: string,
  credential: SandboxCredentialConfig,
  credentialsDir: string,
  resolver: SecretResolver | undefined,
): Promise<Pick<MaterializedCredential, "username" | "passwordFile">> {
  let username = "x-access-token";
  let secret = "";
  if (credential.type === "basic") {
    username = credential.username;
    secret = await resolveSecret(config, resolver, credential.password);
  } else if (credential.type === "api_key") {
    secret = await resolveSecret(config, resolver, credential.apiKey);
  } else if (credential.type === "bearer") {
    secret = await resolveSecret(config, resolver, credential.token);
  } else if (credential.type === "oauth") {
    if (!credential.accessToken)
      throw new Error(
        "OAuth Git credentials require accessToken for Git transport",
      );
    secret = await resolveSecret(config, resolver, credential.accessToken);
  } else if (credential.type === "gpg" || credential.type === "ssh") {
    throw new Error(
      `${credential.type} credential cannot be used for HTTPS Git transport`,
    );
  }
  const file = path.join(credentialsDir, `${safe(name)}_password`);
  await writeFile(file, secret, { mode: 0o600 });
  return { username, passwordFile: file };
}

async function configureCredentialHelpers(
  credentials: MaterializedCredential[],
  credentialsDir: string,
  workspaceDir: string,
  env: Record<string, string>,
): Promise<void> {
  const https = credentials.filter((credential) => credential.passwordFile);
  if (https.length > 0) {
    const manifest = path.join(credentialsDir, "https-credentials.json");
    await writeFile(
      manifest,
      JSON.stringify(
        https.map((credential) => ({
          protocol: credential.protocol ?? "https",
          host: credential.host,
          username: credential.username,
          passwordFile: credential.passwordFile,
        })),
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const helper = path.join(credentialsDir, "credential-helper.mjs");
    await writeFile(helper, credentialHelperScript(manifest), { mode: 0o700 });
    await git(
      ["config", "--global", "credential.helper", `!node ${helper}`],
      workspaceDir,
      env,
    );
  }

  const ssh = credentials.filter((credential) => credential.sshKeyFile);
  if (ssh.length > 0) {
    const sshConfig = path.join(credentialsDir, "ssh_config");
    const knownHosts = path.join(credentialsDir, "known_hosts");
    await writeFile(knownHosts, "", { flag: "a", mode: 0o600 });
    const blocks = ssh.map((credential) => {
      const host = credential.host ?? "*";
      const user = credential.user ?? "git";
      const knownHostsFile = credential.knownHostsFile ?? knownHosts;
      return [
        `Host ${host}`,
        `  HostName ${host}`,
        `  User ${user}`,
        `  IdentityFile ${credential.sshKeyFile}`,
        "  IdentitiesOnly yes",
        `  UserKnownHostsFile ${knownHostsFile}`,
        credential.knownHostsFile
          ? "  StrictHostKeyChecking yes"
          : "  StrictHostKeyChecking accept-new",
      ].join("\n");
    });
    await writeFile(sshConfig, `${blocks.join("\n\n")}\n`, { mode: 0o600 });
    await git(
      ["config", "--global", "core.sshCommand", `ssh -F ${sshConfig}`],
      workspaceDir,
      env,
    );
  }
}

function credentialHelperScript(manifestPath: string): string {
  return `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync(${JSON.stringify(manifestPath)}, "utf8"));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const fields = Object.fromEntries(input.trim().split(/\n+/).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
  }));
  const match = manifest.find((entry) =>
    (!entry.protocol || entry.protocol === fields.protocol) &&
    (!entry.host || entry.host === fields.host)
  );
  if (!match) return;
  const password = readFileSync(match.passwordFile, "utf8");
  process.stdout.write("username=" + (match.username || "x-access-token") + "\\npassword=" + password + "\\n");
});
`;
}

function gitMatchFromUrl(
  url: string | undefined,
): { protocol?: "https" | "ssh"; host?: string; user?: string } | undefined {
  if (!url) return undefined;
  if (url.startsWith("git@")) {
    const host = url.slice(4).split(":", 1)[0];
    return { protocol: "ssh", host, user: "git" };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:")
      return { protocol: "https", host: parsed.hostname };
    if (parsed.protocol === "ssh:")
      return {
        protocol: "ssh",
        host: parsed.hostname,
        user: parsed.username || undefined,
      };
  } catch {
    return undefined;
  }
  return undefined;
}

function assertCredentialReference(
  config: SandboxConfigV1,
  credential: string | SandboxCredentialConfig | undefined,
): void {
  if (!credential || typeof credential !== "string") return;
  if (!config.git?.credentials?.[credential])
    throw new Error(`Git credential profile not found: ${credential}`);
}

async function resolveSecret(
  config: SandboxConfigV1,
  resolver: SecretResolver | undefined,
  ref: SandboxSecretRef,
): Promise<string> {
  return (resolver ?? getResolver(config)).resolve(ref);
}

function getResolver(_config: SandboxConfigV1): SecretResolver {
  // Lazy import would be overkill; callers should pass the entrypoint resolver
  // whenever KV stores are needed. This fallback still supports env/file refs.
  return new (class extends Object {
    async resolve(ref: SandboxSecretRef): Promise<string> {
      if ("env" in ref) {
        const value = process.env[ref.env];
        if (value === undefined)
          throw new Error(`Missing env secret: ${ref.env}`);
        return value;
      }
      if ("file" in ref)
        return (await import("node:fs/promises"))
          .readFile(ref.file, "utf8")
          .then((value) => value.trimEnd());
      throw new Error("KV Git secret refs require the sandbox secret resolver");
    }
  })() as SecretResolver;
}

async function isGitRepository(
  cwd: string,
  env: Record<string, string>,
): Promise<boolean> {
  return git(["rev-parse", "--is-inside-work-tree"], cwd, env)
    .then(() => true)
    .catch(() => false);
}

async function isNonEmptyDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    if (!stats.isDirectory()) return true;
    const entries = await readdir(directory);
    return entries.length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertWithinWorkspace(targetDir: string, workspaceDir: string): void {
  const workspace = path.resolve(workspaceDir);
  const target = path.resolve(targetDir);
  if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`))
    throw new Error("Git clone target must be inside the workspace");
}

async function git(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeout = 10_000,
): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    timeout,
    env: { ...process.env, ...env },
  });
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
