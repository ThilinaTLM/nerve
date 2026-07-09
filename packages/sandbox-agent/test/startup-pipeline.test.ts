import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runBootPlan } from "../src/boot/boot-runner.js";
import { SandboxConfigLoadError } from "../src/config/load-config.js";
import { sandboxEntrypointExitCode } from "../src/entrypoint.js";
import { SandboxPreflightError } from "../src/security/preflight.js";
import { Redactor } from "../src/security/redaction.js";
import { loadSkills } from "../src/skills/skills-loader.js";

const config = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  controller: {
    websocket: { url: "ws://127.0.0.1/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

function withProcessEnv(
  updates: Record<string, string | undefined>,
): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

describe("sandbox startup pipeline helpers", () => {
  it("maps documented startup exit codes", () => {
    assert.equal(
      sandboxEntrypointExitCode(new SandboxConfigLoadError("bad", 10)),
      10,
    );
    assert.equal(
      sandboxEntrypointExitCode(new SandboxPreflightError("mount", 11)),
      11,
    );
    assert.equal(sandboxEntrypointExitCode(new Error("boot phase failed")), 13);
    assert.equal(
      sandboxEntrypointExitCode(new Error("github setup failed")),
      17,
    );
    assert.equal(
      sandboxEntrypointExitCode(new Error("protocol websocket failed")),
      21,
    );
  });

  it("bounds and redacts boot output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-boot-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      await mkdir(workspace);
      await mkdir(state);
      await runBootPlan(
        {
          ...config,
          boot: {
            phases: [
              {
                name: "echo",
                script: "echo token=$BOOT_SECRET",
                env: { BOOT_SECRET: { env: "BOOT_SECRET" } },
              },
            ],
          },
        },
        {
          workspaceDir: workspace,
          stateDir: state,
          redactor: new Redactor(),
          resolver: { resolve: async () => "super-secret" } as never,
        },
      );
      const log = await readFile(
        path.join(state, "boot", "latest.log"),
        "utf8",
      );
      assert.equal(log.includes("super-secret"), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces boot timeouts for shell child processes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-boot-timeout-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      await mkdir(workspace);
      await mkdir(state);
      const started = Date.now();
      await assert.rejects(
        runBootPlan(
          {
            ...config,
            boot: {
              phases: [
                {
                  name: "slow",
                  script: "sleep 5",
                  timeoutMs: 100,
                },
              ],
            },
          },
          { workspaceDir: workspace, stateDir: state },
        ),
        /Boot phase failed: slow/,
      );
      assert.ok(
        Date.now() - started < 2_000,
        "boot timeout should not wait for the child process to finish naturally",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes noninteractive package-manager environment into boot phases without leaking process secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-boot-env-"));
    const restoreEnv = withProcessEnv({
      HOME: "/home/sandbox",
      PNPM_HOME: "/state/cache/dependencies/pnpm",
      NPM_CONFIG_PREFIX: "/state/cache/dependencies/npm-global",
      NPM_CONFIG_CACHE: "/state/cache/dependencies/npm",
      YARN_CACHE_FOLDER: "/state/cache/dependencies/yarn",
      XDG_CACHE_HOME: "/state/cache",
      NVM_DIR: "/home/sandbox/.nvm",
      TERM: "xterm-256color",
      PAGER: "less",
      GIT_PAGER: "less",
      GIT_TERMINAL_PROMPT: "1",
      CI: "0",
      DEBIAN_FRONTEND: "dialog",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "1",
      NPM_CONFIG_YES: "false",
      npm_config_yes: "false",
      NERVE_TEST_TOKEN: "should-not-leak",
      ANTHROPIC_API_KEY: "should-not-leak-either",
    });
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      await mkdir(workspace);
      await mkdir(state);
      await runBootPlan(
        {
          ...config,
          boot: {
            phases: [
              {
                name: "env",
                script: [
                  "printf '%s\\n'",
                  '"HOME=$HOME"',
                  '"PNPM_HOME=$PNPM_HOME"',
                  '"NPM_CONFIG_PREFIX=$NPM_CONFIG_PREFIX"',
                  '"NPM_CONFIG_CACHE=$NPM_CONFIG_CACHE"',
                  '"YARN_CACHE_FOLDER=$YARN_CACHE_FOLDER"',
                  '"XDG_CACHE_HOME=$XDG_CACHE_HOME"',
                  '"NVM_DIR=$NVM_DIR"',
                  '"TERM=$TERM"',
                  '"PAGER=$PAGER"',
                  '"GIT_PAGER=$GIT_PAGER"',
                  '"GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT"',
                  '"CI=$CI"',
                  '"DEBIAN_FRONTEND=$DEBIAN_FRONTEND"',
                  '"COREPACK_ENABLE_DOWNLOAD_PROMPT=$COREPACK_ENABLE_DOWNLOAD_PROMPT"',
                  '"NPM_CONFIG_YES=$NPM_CONFIG_YES"',
                  '"npm_config_yes=$npm_config_yes"',
                  '"NERVE_TEST_TOKEN=$NERVE_TEST_TOKEN"',
                  '"ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"',
                ].join(" "),
              },
            ],
          },
        },
        { workspaceDir: workspace, stateDir: state },
      );
      const log = await readFile(
        path.join(state, "boot", "latest.log"),
        "utf8",
      );
      assert.match(log, /^HOME=\/home\/sandbox$/m);
      assert.match(log, /^PNPM_HOME=\/state\/cache\/dependencies\/pnpm$/m);
      assert.match(
        log,
        /^NPM_CONFIG_PREFIX=\/state\/cache\/dependencies\/npm-global$/m,
      );
      assert.match(
        log,
        /^NPM_CONFIG_CACHE=\/state\/cache\/dependencies\/npm$/m,
      );
      assert.match(
        log,
        /^YARN_CACHE_FOLDER=\/state\/cache\/dependencies\/yarn$/m,
      );
      assert.match(log, /^XDG_CACHE_HOME=\/state\/cache$/m);
      assert.match(log, /^NVM_DIR=\/home\/sandbox\/\.nvm$/m);
      assert.match(log, /^TERM=dumb$/m);
      assert.match(log, /^PAGER=cat$/m);
      assert.match(log, /^GIT_PAGER=cat$/m);
      assert.match(log, /^GIT_TERMINAL_PROMPT=0$/m);
      assert.match(log, /^CI=1$/m);
      assert.match(log, /^DEBIAN_FRONTEND=noninteractive$/m);
      assert.match(log, /^COREPACK_ENABLE_DOWNLOAD_PROMPT=0$/m);
      assert.match(log, /^NPM_CONFIG_YES=true$/m);
      assert.match(log, /^npm_config_yes=true$/m);
      assert.match(log, /^NERVE_TEST_TOKEN=$/m);
      assert.match(log, /^ANTHROPIC_API_KEY=$/m);
      assert.equal(log.includes("should-not-leak"), false);
      assert.equal(log.includes("should-not-leak-either"), false);
    } finally {
      restoreEnv();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows explicit boot env to override noninteractive defaults", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-boot-env-override-"),
    );
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      await mkdir(workspace);
      await mkdir(state);
      await runBootPlan(
        {
          ...config,
          boot: {
            phases: [
              {
                name: "env override",
                script: 'printf \'%s\\n\' "CI=$CI" "PAGER=$PAGER"',
              },
            ],
          },
        },
        {
          workspaceDir: workspace,
          stateDir: state,
          env: { CI: "0", PAGER: "less" },
        },
      );
      const log = await readFile(
        path.join(state, "boot", "latest.log"),
        "utf8",
      );
      assert.match(log, /^CI=0$/m);
      assert.match(log, /^PAGER=less$/m);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads skills deterministically with count and byte bounds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-skills-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      const skillsRoot = path.join(workspace, ".agents", "skills");
      await mkdir(path.join(skillsRoot, "a"), { recursive: true });
      await mkdir(path.join(skillsRoot, "b"), { recursive: true });
      await writeFile(path.join(skillsRoot, "a", "SKILL.md"), "short");
      await writeFile(path.join(skillsRoot, "b", "SKILL.md"), "too-long");
      await chmod(workspace, 0o700);
      const skills = await loadSkills(
        {
          ...config,
          skills: {
            builtin: { path: path.join(dir, "none") },
            allowWorkspaceSkills: true,
            maxSkillBytes: 5,
            maxSkillCount: 1,
          },
        },
        workspace,
        state,
      );
      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["a"],
      );
      assert.equal(skills[0]?.source, "workspace");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
