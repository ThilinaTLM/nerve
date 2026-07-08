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

  it("passes package-manager environment into boot phases without leaking process secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-boot-env-"));
    const restoreEnv = withProcessEnv({
      HOME: "/home/sandbox",
      PNPM_HOME: "/state/cache/dependencies/pnpm",
      NPM_CONFIG_PREFIX: "/state/cache/dependencies/npm-global",
      NPM_CONFIG_CACHE: "/state/cache/dependencies/npm",
      YARN_CACHE_FOLDER: "/state/cache/dependencies/yarn",
      XDG_CACHE_HOME: "/state/cache",
      NVM_DIR: "/home/sandbox/.nvm",
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
      assert.match(log, /^NERVE_TEST_TOKEN=$/m);
      assert.match(log, /^ANTHROPIC_API_KEY=$/m);
      assert.equal(log.includes("should-not-leak"), false);
      assert.equal(log.includes("should-not-leak-either"), false);
    } finally {
      restoreEnv();
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
