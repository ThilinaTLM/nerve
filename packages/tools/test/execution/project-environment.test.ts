import assert from "node:assert/strict";
import { join, resolve as resolvePath } from "node:path";
import { describe, it } from "node:test";
import { resolveProjectShellInvocation } from "../../src/execution/shell/project-environment.js";

const root = resolvePath("project-environment-fixture");
const workspace = join(root, "workspace", "project");
const app = join(workspace, "packages", "app");
const tools = join(root, "tools");
const home = join(root, "home", "user");
const xdg = join(root, "xdg");
const shell = join(root, "bin", "bash");
const shellConfig = { shell, args: ["-c"] };

function tool(name: string): string {
  return join(tools, name);
}

function resolve(
  files: string[],
  env: NodeJS.ProcessEnv = {},
  options: { platform?: NodeJS.Platform; executables?: string[] } = {},
) {
  const existing = new Set(files);
  const executables = new Set(options.executables ?? []);
  return resolveProjectShellInvocation("node --version", {
    cwd: app,
    env,
    shellConfig,
    platform: options.platform ?? "linux",
    pathExists: (path) => existing.has(path),
    pathIsExecutable: (path) => executables.has(path),
  });
}

describe("project shell environment resolver", () => {
  it("preserves the base invocation when no adapter applies", () => {
    const env = { PATH: tools };
    assert.deepEqual(resolve([], env), {
      shell,
      args: ["-c", "node --version"],
      env,
      launch: { cwd: app, executable: shell, shell },
    });
  });

  it("uses direnv first and keeps its approval enforcement external", () => {
    const result = resolve(
      [
        join(workspace, ".envrc"),
        join(workspace, "mise.toml"),
        join(workspace, ".nvmrc"),
      ],
      { PATH: tools },
      { executables: [tool("direnv"), tool("mise"), tool("fnm")] },
    );

    assert.equal(result.manager, "direnv");
    assert.equal(result.shell, tool("direnv"));
    assert.deepEqual(result.launch, {
      cwd: app,
      executable: tool("direnv"),
      shell,
      manager: "direnv",
      configFile: join(workspace, ".envrc"),
    });
    assert.deepEqual(result.args, ["exec", app, shell, "-c", "node --version"]);
  });

  it("uses mise for mise-owned configuration in paranoid mode", () => {
    const result = resolve(
      [join(workspace, ".mise.toml")],
      { PATH: tools, MISE_PARANOID: "0" },
      { executables: [tool("mise")] },
    );

    assert.equal(result.manager, "mise");
    assert.equal(result.shell, tool("mise"));
    assert.equal(result.launch.configFile, join(workspace, ".mise.toml"));
    assert.deepEqual(result.args, [
      "exec",
      "--",
      shell,
      "-c",
      "node --version",
    ]);
    assert.equal(result.env.MISE_PARANOID, "1");
    assert.equal(result.env.MISE_AUTO_INSTALL, "false");
    assert.equal(result.env.MISE_EXEC_AUTO_INSTALL, "false");
  });

  it("does not claim bare .tool-versions unless mise is active", () => {
    const files = [join(workspace, ".tool-versions")];
    const executables = [tool("mise")];
    assert.equal(
      resolve(files, { PATH: tools }, { executables }).manager,
      undefined,
    );
    const active = resolve(
      files,
      { PATH: tools, MISE_SHELL: "bash" },
      { executables },
    );
    assert.equal(active.manager, "mise");
    assert.equal(active.launch.configFile, join(workspace, ".tool-versions"));
  });

  it("passes the nearest Node version file to fnm without install flags", () => {
    const versionFile = join(app, ".node-version");
    const result = resolve(
      [join(workspace, ".nvmrc"), versionFile],
      { PATH: tools },
      { executables: [tool("fnm")] },
    );

    assert.equal(result.manager, "fnm");
    assert.deepEqual(result.launch, {
      cwd: app,
      executable: tool("fnm"),
      shell,
      manager: "fnm",
      configFile: versionFile,
    });
    assert.deepEqual(result.args, [
      "exec",
      `--using=${versionFile}`,
      "--log-level=error",
      "--",
      shell,
      "-c",
      "node --version",
    ]);
    assert.doesNotMatch(result.args.join(" "), /install/);
  });

  it("sources nvm for .nvmrc and gates the command on successful use", () => {
    const nvmDir = join(home, ".nvm");
    const result = resolve(
      [join(workspace, ".nvmrc"), join(nvmDir, "nvm.sh")],
      { PATH: tools, HOME: home },
    );

    assert.equal(result.manager, "nvm");
    assert.equal(result.shell, shell);
    assert.equal(result.env.NVM_DIR, nvmDir);
    assert.deepEqual(result.launch, {
      cwd: app,
      executable: shell,
      shell,
      manager: "nvm",
      configFile: join(workspace, ".nvmrc"),
    });
    assert.deepEqual(result.args, [
      "-c",
      '. "$NVM_DIR/nvm.sh" && nvm use --silent &&\nnode --version',
    ]);
  });

  it("prefers the inherited active Node manager", () => {
    const nvmDir = join(root, "custom", "nvm");
    const files = [join(workspace, ".nvmrc"), join(nvmDir, "nvm.sh")];
    const executables = [tool("fnm")];

    assert.equal(
      resolve(files, { PATH: tools, NVM_DIR: nvmDir }, { executables }).manager,
      "nvm",
    );
    assert.equal(
      resolve(
        files,
        {
          PATH: tools,
          NVM_DIR: nvmDir,
          FNM_MULTISHELL_PATH: join(root, "tmp", "fnm-shell"),
        },
        { executables },
      ).manager,
      "fnm",
    );
  });

  it("keeps nvm installation paths out of generated shell syntax", () => {
    const nvmDir = join(root, "home", "user's files", ".nvm");
    const result = resolve(
      [join(workspace, ".nvmrc"), join(nvmDir, "nvm.sh")],
      { NVM_DIR: nvmDir },
    );

    assert.equal(result.manager, "nvm");
    assert.equal(result.env.NVM_DIR, nvmDir);
    assert.doesNotMatch(result.args.join(" "), /user's files/);
  });

  it("finds nvm through XDG before the default home location", () => {
    const xdgNvm = join(xdg, "nvm");
    const result = resolve(
      [
        join(workspace, ".nvmrc"),
        join(xdgNvm, "nvm.sh"),
        join(home, ".nvm", "nvm.sh"),
      ],
      { HOME: home, XDG_CONFIG_HOME: xdg },
    );

    assert.equal(result.manager, "nvm");
    assert.equal(result.env.NVM_DIR, xdgNvm);
  });

  it("bypasses activation before any config or executable probes", () => {
    const env = { PATH: tools, FNM_DIR: tools, MISE_SHELL: "bash" };
    const unexpectedProbe = () => {
      assert.fail("disabled project activation must not probe");
    };
    const result = resolveProjectShellInvocation("node --version", {
      cwd: app,
      env,
      shellConfig,
      projectEnvironment: false,
      pathExists: unexpectedProbe,
      pathIsExecutable: unexpectedProbe,
    });
    assert.deepEqual(result, {
      shell,
      args: ["-c", "node --version"],
      env,
      launch: { cwd: app, executable: shell, shell },
    });
    assert.equal(result.env, env);
  });

  it("discovers Windows fnm with Path and uppercase executable extensions", () => {
    const versionFile = join(app, ".nvmrc");
    const executable = tool("fnm.EXE");
    const result = resolve(
      [versionFile],
      { Path: `${join(root, "missing")};${tools}`, PATHEXT: ".COM;.EXE" },
      { platform: "win32", executables: [executable] },
    );
    assert.deepEqual(result.launch, {
      cwd: app,
      executable,
      shell,
      manager: "fnm",
      configFile: versionFile,
    });
    assert.equal(result.shell, executable);
    assert.ok(result.args.includes("--log-level=error"));
  });

  it("keeps mise precedence over Node managers and selects its nearest config", () => {
    const configFile = join(app, "mise.toml");
    const result = resolve(
      [join(workspace, ".mise.toml"), configFile, join(app, ".node-version")],
      { PATH: tools, FNM_DIR: tools },
      { executables: [tool("mise"), tool("fnm")] },
    );
    assert.equal(result.manager, "mise");
    assert.equal(result.launch.configFile, configFile);
  });

  it("does not use sourced nvm on Windows", () => {
    const nvmDir = join(home, ".nvm");
    const result = resolve(
      [join(workspace, ".nvmrc"), join(nvmDir, "nvm.sh")],
      { HOME: home },
      { platform: "win32" },
    );
    assert.equal(result.manager, undefined);
  });
});
