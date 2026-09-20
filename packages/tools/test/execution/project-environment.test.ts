import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProjectShellInvocation } from "../../src/execution/shell/project-environment.js";

const shellConfig = { shell: "/bin/bash", args: ["-c"] };

function resolve(
  files: string[],
  env: NodeJS.ProcessEnv = {},
  options: { platform?: NodeJS.Platform; executables?: string[] } = {},
) {
  const existing = new Set(files);
  const executables = new Set(options.executables ?? []);
  return resolveProjectShellInvocation("node --version", {
    cwd: "/workspace/project/packages/app",
    env,
    shellConfig,
    platform: options.platform ?? "linux",
    pathExists: (path) => existing.has(path),
    pathIsExecutable: (path) => executables.has(path),
  });
}

describe("project shell environment resolver", () => {
  it("preserves the base invocation when no adapter applies", () => {
    const env = { PATH: "/tools" };
    assert.deepEqual(resolve([], env), {
      shell: "/bin/bash",
      args: ["-c", "node --version"],
      env,
    });
  });

  it("uses direnv first and keeps its approval enforcement external", () => {
    const result = resolve(
      [
        "/workspace/project/.envrc",
        "/workspace/project/mise.toml",
        "/workspace/project/.nvmrc",
      ],
      { PATH: "/tools" },
      { executables: ["/tools/direnv", "/tools/mise", "/tools/fnm"] },
    );

    assert.equal(result.manager, "direnv");
    assert.equal(result.shell, "/tools/direnv");
    assert.deepEqual(result.args, [
      "exec",
      "/workspace/project/packages/app",
      "/bin/bash",
      "-c",
      "node --version",
    ]);
  });

  it("uses mise for mise-owned configuration in paranoid mode", () => {
    const result = resolve(
      ["/workspace/project/.mise.toml"],
      { PATH: "/tools", MISE_PARANOID: "0" },
      { executables: ["/tools/mise"] },
    );

    assert.equal(result.manager, "mise");
    assert.equal(result.shell, "/tools/mise");
    assert.deepEqual(result.args, [
      "exec",
      "--",
      "/bin/bash",
      "-c",
      "node --version",
    ]);
    assert.equal(result.env.MISE_PARANOID, "1");
    assert.equal(result.env.MISE_AUTO_INSTALL, "false");
    assert.equal(result.env.MISE_EXEC_AUTO_INSTALL, "false");
  });

  it("does not claim bare .tool-versions unless mise is active", () => {
    const files = ["/workspace/project/.tool-versions"];
    const executables = ["/tools/mise"];
    assert.equal(
      resolve(files, { PATH: "/tools" }, { executables }).manager,
      undefined,
    );
    assert.equal(
      resolve(files, { PATH: "/tools", MISE_SHELL: "bash" }, { executables })
        .manager,
      "mise",
    );
  });

  it("passes the nearest Node version file to fnm without install flags", () => {
    const result = resolve(
      [
        "/workspace/project/.nvmrc",
        "/workspace/project/packages/app/.node-version",
      ],
      { PATH: "/tools" },
      { executables: ["/tools/fnm"] },
    );

    assert.equal(result.manager, "fnm");
    assert.deepEqual(result.args, [
      "exec",
      "--using=/workspace/project/packages/app/.node-version",
      "--log-level=quiet",
      "--",
      "/bin/bash",
      "-c",
      "node --version",
    ]);
    assert.doesNotMatch(result.args.join(" "), /install/);
  });

  it("sources nvm for .nvmrc and gates the command on successful use", () => {
    const result = resolve(
      ["/workspace/project/.nvmrc", "/home/user/.nvm/nvm.sh"],
      { PATH: "/tools", HOME: "/home/user" },
    );

    assert.equal(result.manager, "nvm");
    assert.equal(result.shell, "/bin/bash");
    assert.equal(result.env.NVM_DIR, "/home/user/.nvm");
    assert.deepEqual(result.args, [
      "-c",
      '. "$NVM_DIR/nvm.sh" && nvm use --silent &&\nnode --version',
    ]);
  });

  it("prefers the inherited active Node manager", () => {
    const files = ["/workspace/project/.nvmrc", "/custom/nvm/nvm.sh"];
    const executables = ["/tools/fnm"];

    assert.equal(
      resolve(
        files,
        { PATH: "/tools", NVM_DIR: "/custom/nvm" },
        { executables },
      ).manager,
      "nvm",
    );
    assert.equal(
      resolve(
        files,
        {
          PATH: "/tools",
          NVM_DIR: "/custom/nvm",
          FNM_MULTISHELL_PATH: "/tmp/fnm-shell",
        },
        { executables },
      ).manager,
      "fnm",
    );
  });

  it("keeps nvm installation paths out of generated shell syntax", () => {
    const result = resolve(
      ["/workspace/project/.nvmrc", "/home/user's files/.nvm/nvm.sh"],
      { NVM_DIR: "/home/user's files/.nvm" },
    );

    assert.equal(result.manager, "nvm");
    assert.equal(result.env.NVM_DIR, "/home/user's files/.nvm");
    assert.doesNotMatch(result.args.join(" "), /user's files/);
  });

  it("finds nvm through XDG before the default home location", () => {
    const result = resolve(
      [
        "/workspace/project/.nvmrc",
        "/xdg/nvm/nvm.sh",
        "/home/user/.nvm/nvm.sh",
      ],
      {
        HOME: "/home/user",
        XDG_CONFIG_HOME: "/xdg",
      },
    );

    assert.equal(result.manager, "nvm");
    assert.equal(result.env.NVM_DIR, "/xdg/nvm");
  });

  it("does not use sourced nvm on Windows", () => {
    const result = resolve(
      ["/workspace/project/.nvmrc", "/home/user/.nvm/nvm.sh"],
      { HOME: "/home/user" },
      { platform: "win32" },
    );
    assert.equal(result.manager, undefined);
  });
});
