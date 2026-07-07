import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1, SandboxSecretRef, StartupSetupStatus } from "@nervekit/shared";
import type { SecretResolver } from "../credentials/secret-resolver.js";

export type GithubSetupOptions = {
  credentialsDir?: string;
  resolver?: SecretResolver;
  env?: Record<string, string>;
};

export async function runGithubSetup(
  config: SandboxConfigV1,
  optionsOrCredentialsDir: GithubSetupOptions | string = {},
): Promise<StartupSetupStatus> {
  if (!config.github?.enabled) return { configured: false, status: "skipped" };
  const options =
    typeof optionsOrCredentialsDir === "string"
      ? { credentialsDir: optionsOrCredentialsDir }
      : optionsOrCredentialsDir;
  const credentialsDir = options.credentialsDir ?? "/state/credentials";
  const githubDir = path.join(credentialsDir, "github");
  const startedAt = new Date().toISOString();
  const limitations: string[] = [];
  try {
    await mkdir(githubDir, { recursive: true, mode: 0o700 });
    const token = await resolveGithubToken(config, options.resolver);
    if (token) {
      const tokenFile = path.join(githubDir, "token");
      await writeFile(tokenFile, token, { mode: 0o600 });
      await writeFile(path.join(githubDir, "env.sh"), `export GH_TOKEN="$(cat ${shellQuote(tokenFile)})"\n`, {
        mode: 0o600,
      });
      await writeFile(
        path.join(githubDir, "github-askpass.sh"),
        `#!/bin/sh\ncat ${shellQuote(tokenFile)}\n`,
        { mode: 0o700 },
      );
    } else {
      limitations.push("github auth token was not configured");
    }
    if (config.github.cli?.enabled)
      limitations.push("GitHub CLI auth files are prepared only when gh is installed in derived images");
    return {
      configured: true,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      limitations: limitations.length ? limitations : undefined,
    };
  } catch (error) {
    return {
      configured: true,
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      error: {
        code: "GITHUB_SETUP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function resolveGithubToken(
  config: SandboxConfigV1,
  resolver: SecretResolver | undefined,
): Promise<string | undefined> {
  const auth = config.github?.auth;
  if (!auth) return undefined;
  if (auth.type === "pat" || auth.type === "app_token")
    return resolveSecret(config, resolver, auth.token);
  if (auth.type === "oauth") {
    if (auth.accessToken) return resolveSecret(config, resolver, auth.accessToken);
    if (auth.source) return resolveSecret(config, resolver, auth.source);
  }
  return undefined;
}

async function resolveSecret(
  config: SandboxConfigV1,
  resolver: SecretResolver | undefined,
  ref: SandboxSecretRef,
): Promise<string> {
  if (resolver) return resolver.resolve(ref);
  if ("env" in ref) {
    const value = process.env[ref.env];
    if (value === undefined) throw new Error(`Missing env secret: ${ref.env}`);
    return value;
  }
  if ("file" in ref)
    return (await import("node:fs/promises")).readFile(ref.file, "utf8").then((value) => value.trimEnd());
  throw new Error("KV GitHub secret refs require the sandbox secret resolver");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
