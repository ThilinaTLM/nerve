import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { runGitSetup } from "../src/setup/git-setup.js";

const execFileAsync = promisify(execFile);

const baseConfig = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  controller: {
    websocket: { url: "ws://127.0.0.1/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("git setup", () => {
  it("writes sandbox-global identity before a repository exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-git-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      const credentials = path.join(state, "credentials");
      await mkdir(workspace, { recursive: true });
      const result = await runGitSetup(
        {
          ...baseConfig,
          git: {
            enabled: true,
            identity: { name: "Sandbox Bot", email: "bot@example.com" },
            safeDirectory: "workspace",
          },
        },
        {
          workspaceDir: workspace,
          stateDir: state,
          credentialsDir: credentials,
        },
      );

      assert.equal(result.status, "completed");
      assert.equal(
        result.env?.GIT_CONFIG_GLOBAL,
        path.join(state, "git", "config"),
      );
      const { stdout: name } = await execFileAsync(
        "git",
        ["config", "--global", "user.name"],
        { cwd: workspace, env: { ...process.env, ...result.env } },
      );
      assert.equal(name.trim(), "Sandbox Bot");
      const config = await readFile(path.join(state, "git", "config"), "utf8");
      assert.match(config, /\[safe\]/);
      assert.match(config, /directory =/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("materializes HTTPS credentials without writing token values to Git config", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-git-cred-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      const credentials = path.join(state, "credentials");
      await mkdir(workspace, { recursive: true });
      const tokenFile = path.join(dir, "token");
      await writeFile(tokenFile, "ghp_super_secret_token");
      const result = await runGitSetup(
        {
          ...baseConfig,
          git: {
            enabled: true,
            credentials: {
              github: {
                match: { protocol: "https", host: "github.com" },
                credential: { type: "api_key", apiKey: { file: tokenFile } },
              },
            },
          },
        },
        {
          workspaceDir: workspace,
          stateDir: state,
          credentialsDir: credentials,
        },
      );

      assert.equal(result.status, "completed");
      const config = await readFile(path.join(state, "git", "config"), "utf8");
      assert.equal(config.includes("ghp_super_secret_token"), false);
      const password = await readFile(
        path.join(credentials, "git", "github_password"),
        "utf8",
      );
      assert.equal(password, "ghp_super_secret_token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes SSH key files with restricted permissions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-git-ssh-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      const credentials = path.join(state, "credentials");
      await mkdir(workspace, { recursive: true });
      const keyFile = path.join(dir, "id_ed25519");
      await writeFile(
        keyFile,
        "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n",
      );
      const result = await runGitSetup(
        {
          ...baseConfig,
          git: {
            enabled: true,
            credentials: {
              github: {
                match: { protocol: "ssh", host: "github.com", user: "git" },
                credential: { type: "ssh", privateKey: { file: keyFile } },
              },
            },
          },
        },
        {
          workspaceDir: workspace,
          stateDir: state,
          credentialsDir: credentials,
        },
      );

      assert.equal(result.status, "completed");
      const materialized = path.join(credentials, "git", "github_id");
      assert.equal((await stat(materialized)).mode & 0o777, 0o600);
      const config = await readFile(path.join(state, "git", "config"), "utf8");
      assert.match(config, /sshCommand = ssh -F/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
