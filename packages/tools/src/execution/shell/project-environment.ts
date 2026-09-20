import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { ShellConfig } from "./shell-config.js";

export type ProjectEnvironmentManager = "direnv" | "mise" | "fnm" | "nvm";

export interface ProjectShellInvocation {
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  manager?: ProjectEnvironmentManager;
}

export interface ResolveProjectShellInvocationOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shellConfig: ShellConfig;
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
  pathIsExecutable?: (path: string) => boolean;
}

type ResolutionContext = Required<
  Pick<ResolveProjectShellInvocationOptions, "cwd" | "env" | "shellConfig">
> & {
  platform: NodeJS.Platform;
  pathExists: (path: string) => boolean;
  pathIsExecutable: (path: string) => boolean;
};

type Adapter = (
  command: string,
  context: ResolutionContext,
) => ProjectShellInvocation | undefined;

const MISE_CONFIG_FILES = [
  "mise.toml",
  ".mise.toml",
  "mise.local.toml",
  ".mise.local.toml",
  "mise/config.toml",
] as const;

function defaultPathIsExecutable(
  path: string,
  platform: NodeJS.Platform,
): boolean {
  try {
    accessSync(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findAncestorFile(
  cwd: string,
  relativePaths: readonly string[],
  pathExists: (path: string) => boolean,
): string | undefined {
  let directory = cwd;
  while (true) {
    for (const relativePath of relativePaths) {
      const candidate = join(directory, relativePath);
      if (pathExists(candidate)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function executableExtensions(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform !== "win32") return [""];
  const extensions = env.PATHEXT?.split(";").filter(Boolean) ?? [
    ".COM",
    ".EXE",
    ".BAT",
    ".CMD",
  ];
  return [
    "",
    ...new Set(
      extensions.flatMap((extension) => [extension, extension.toLowerCase()]),
    ),
  ];
}

function findExecutable(
  name: string,
  context: ResolutionContext,
): string | undefined {
  const pathValue = context.env.PATH ?? context.env.Path;
  if (!pathValue) return undefined;
  const separator = context.platform === "win32" ? ";" : delimiter;
  for (const directory of pathValue.split(separator)) {
    if (!directory) continue;
    const absoluteDirectory = isAbsolute(directory)
      ? directory
      : resolve(context.cwd, directory);
    for (const extension of executableExtensions(
      context.platform,
      context.env,
    )) {
      const candidate = join(absoluteDirectory, `${name}${extension}`);
      if (context.pathIsExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function wrappedInvocation(
  manager: ProjectEnvironmentManager,
  executable: string,
  args: string[],
  context: ResolutionContext,
  env: NodeJS.ProcessEnv = context.env,
): ProjectShellInvocation {
  return { shell: executable, args, env, manager };
}

const resolveDirenv: Adapter = (command, context) => {
  if (!findAncestorFile(context.cwd, [".envrc"], context.pathExists)) {
    return undefined;
  }
  const executable = findExecutable("direnv", context);
  if (!executable) return undefined;
  return wrappedInvocation(
    "direnv",
    executable,
    [
      "exec",
      context.cwd,
      context.shellConfig.shell,
      ...context.shellConfig.args,
      command,
    ],
    context,
  );
};

const resolveMise: Adapter = (command, context) => {
  const config = findAncestorFile(
    context.cwd,
    MISE_CONFIG_FILES,
    context.pathExists,
  );
  const toolVersions = context.env.MISE_SHELL
    ? findAncestorFile(context.cwd, [".tool-versions"], context.pathExists)
    : undefined;
  if (!config && !toolVersions) return undefined;
  const executable = findExecutable("mise", context);
  if (!executable) return undefined;
  return wrappedInvocation(
    "mise",
    executable,
    [
      "exec",
      "--",
      context.shellConfig.shell,
      ...context.shellConfig.args,
      command,
    ],
    context,
    {
      ...context.env,
      MISE_AUTO_INSTALL: "false",
      MISE_EXEC_AUTO_INSTALL: "false",
      MISE_PARANOID: "1",
    },
  );
};

function resolveNvmScript(context: ResolutionContext): string | undefined {
  if (context.platform === "win32") return undefined;
  const directories = [
    context.env.NVM_DIR,
    context.env.XDG_CONFIG_HOME
      ? join(context.env.XDG_CONFIG_HOME, "nvm")
      : undefined,
    context.env.HOME ? join(context.env.HOME, ".nvm") : undefined,
  ];
  for (const directory of directories) {
    if (!directory) continue;
    const script = join(directory, "nvm.sh");
    if (context.pathExists(script)) return script;
  }
  return undefined;
}

function fnmInvocation(
  command: string,
  versionFile: string,
  executable: string,
  context: ResolutionContext,
): ProjectShellInvocation {
  return wrappedInvocation(
    "fnm",
    executable,
    [
      "exec",
      `--using=${versionFile}`,
      "--log-level=quiet",
      "--",
      context.shellConfig.shell,
      ...context.shellConfig.args,
      command,
    ],
    context,
  );
}

function nvmInvocation(
  command: string,
  nvmScript: string,
  context: ResolutionContext,
): ProjectShellInvocation {
  const nvmDir = dirname(nvmScript);
  const activation = '. "$NVM_DIR/nvm.sh" && nvm use --silent &&\n' + command;
  return wrappedInvocation(
    "nvm",
    context.shellConfig.shell,
    [...context.shellConfig.args, activation],
    context,
    { ...context.env, NVM_DIR: nvmDir },
  );
}

const resolveNodeManager: Adapter = (command, context) => {
  const versionFile = findAncestorFile(
    context.cwd,
    [".node-version", ".nvmrc"],
    context.pathExists,
  );
  if (!versionFile) return undefined;

  const fnm = findExecutable("fnm", context);
  const nvm = versionFile.endsWith(".nvmrc")
    ? resolveNvmScript(context)
    : undefined;

  if ((context.env.FNM_MULTISHELL_PATH || context.env.FNM_DIR) && fnm) {
    return fnmInvocation(command, versionFile, fnm, context);
  }
  if (context.env.NVM_DIR && nvm) {
    return nvmInvocation(command, nvm, context);
  }
  if (fnm) return fnmInvocation(command, versionFile, fnm, context);
  if (nvm) return nvmInvocation(command, nvm, context);
  return undefined;
};

const adapters: readonly Adapter[] = [
  resolveDirenv,
  resolveMise,
  resolveNodeManager,
];

export function resolveProjectShellInvocation(
  command: string,
  options: ResolveProjectShellInvocationOptions,
): ProjectShellInvocation {
  const platform = options.platform ?? process.platform;
  const context: ResolutionContext = {
    cwd: options.cwd,
    env: options.env,
    shellConfig: options.shellConfig,
    platform,
    pathExists: options.pathExists ?? existsSync,
    pathIsExecutable:
      options.pathIsExecutable ??
      ((path) => defaultPathIsExecutable(path, platform)),
  };
  for (const adapter of adapters) {
    const invocation = adapter(command, context);
    if (invocation) return invocation;
  }
  return {
    shell: context.shellConfig.shell,
    args: [...context.shellConfig.args, command],
    env: context.env,
  };
}
