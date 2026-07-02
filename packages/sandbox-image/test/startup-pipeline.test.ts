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
import { loadSkills } from "../src/skills/skills-loader.js";

const config = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  controller: {
    websocket: { url: "ws://127.0.0.1/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

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
          redactor: undefined,
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
