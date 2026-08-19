import type { ChildProcess, SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ExecutionWorkerClient } from "@nervekit/native";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import crossSpawn from "cross-spawn";

export type ExecutablePlatform = NodeJS.Platform;

export type ResolvedExecutable = {
  path: string;
  kind: "native" | "windows_script";
};

export type ExecutableLocatorOptions = {
  platform?: ExecutablePlatform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  cwd?: string;
  additionalDirectories?: readonly string[];
  additionalPaths?: readonly string[];
};

export type ExecutableRunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
};

export type ExecutableRunResult = {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
  timedOut: boolean;
};

const WINDOWS_EXECUTABLE_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"];
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

export async function locateExecutable(
  command: string,
  options: ExecutableLocatorOptions = {},
): Promise<ResolvedExecutable | undefined> {
  const value = command.trim();
  if (!value) return undefined;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const candidates = executableNames(value, platform, env);

  if (isAbsolute(value) || value.includes("/") || value.includes("\\")) {
    const base = isAbsolute(value)
      ? value
      : resolve(options.cwd ?? process.cwd(), value);
    for (const candidate of executableNames(base, platform, env)) {
      if (await isExecutableFile(candidate, platform)) {
        return resolvedExecutable(candidate, platform);
      }
    }
    return undefined;
  }

  const directories = await executableSearchDirectories(options);
  for (const directory of directories) {
    for (const candidate of candidates) {
      const path = join(directory, candidate);
      if (await isExecutableFile(path, platform)) {
        return resolvedExecutable(path, platform);
      }
    }
  }

  for (const path of options.additionalPaths ?? []) {
    for (const candidate of executableNames(path, platform, env)) {
      if (await isExecutableFile(candidate, platform)) {
        return resolvedExecutable(candidate, platform);
      }
    }
  }
  return undefined;
}

export async function executableSearchDirectories(
  options: ExecutableLocatorOptions = {},
): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homeFromEnvironment(env) ?? homedir();
  const delimiter = platform === "win32" ? ";" : ":";
  const inheritedPath = environmentValue(env, "PATH") ?? "";
  const directories = [
    ...inheritedPath.split(delimiter),
    ...(options.additionalDirectories ?? []),
    ...conventionalDirectories(platform, env, home),
  ];
  directories.push(...(await versionManagerDirectories(platform, home)));
  return deduplicatePaths(directories, platform);
}

export function spawnExecutable(
  executable: ResolvedExecutable | string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const path = typeof executable === "string" ? executable : executable.path;
  return crossSpawn(path, [...args], {
    windowsHide: true,
    ...options,
    env: executableEnvironment(path, options.env ?? process.env),
  });
}

export async function runExecutable(
  executable: ResolvedExecutable | string,
  args: readonly string[],
  options: ExecutableRunOptions = {},
): Promise<ExecutableRunResult> {
  // Route execution through the Rust worker so process lifetime, durable
  // output, and termination semantics are owned by the worker.
  if (!process.env.NERVE_HOME) {
    throw new Error(
      "Execution worker home (NERVE_HOME) is required to run an executable through the execution worker.",
    );
  }
  const client = await ExecutionWorkerClient.connect(process.env.NERVE_HOME);
  const executionId = `executable_${randomUUID()}`;
  const path = typeof executable === "string" ? executable : executable.path;
  const workerChild = (
    await client.spawnChild({
      executionId,
      command: path,
      args: [...args],
      cwd: options.cwd,
      env: Object.fromEntries(
        Object.entries(
          executableEnvironment(path, options.env ?? process.env),
        ).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      timeoutMs: options.timeoutMs,
      terminationGraceMs: 500,
      belowNormalPriority: true,
    })
  ).child;
  const workerCleanup = () => {
    void client.remove(executionId).catch(() => undefined);
  };
  return await new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let error: Error | undefined;
    let timedOut = false;
    let settled = false;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const child = workerChild;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;
    timer?.unref();
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      workerCleanup?.();
      resolveResult({ stdout, stderr, status, error, timedOut });
    };
    const append = (current: string, chunk: string): string => {
      const remaining = Math.max(0, maxBuffer - Buffer.byteLength(current));
      if (remaining === 0) return current;
      return (
        current + Buffer.from(chunk).subarray(0, remaining).toString("utf8")
      );
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (cause) => {
      error = cause;
    });
    child.once("close", finish);
  });
}

function executableEnvironment(
  executable: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = { ...env };
  const key = environmentKey(result, "PATH") ?? "PATH";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const parent = dirname(executable);
  if (parent && parent !== ".") {
    const existing = result[key];
    result[key] = existing ? `${parent}${delimiter}${existing}` : parent;
  }
  return result;
}

function executableNames(
  command: string,
  platform: ExecutablePlatform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform !== "win32") return [command];
  const extension = extname(command).toLowerCase();
  if (WINDOWS_EXECUTABLE_EXTENSIONS.includes(extension)) return [command];
  const pathExt = environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => WINDOWS_EXECUTABLE_EXTENSIONS.includes(value));
  return [...new Set(extensions.map((value) => `${command}${value}`))];
}

function resolvedExecutable(
  path: string,
  platform: ExecutablePlatform,
): ResolvedExecutable {
  const extension = extname(path).toLowerCase();
  return {
    path,
    kind:
      platform === "win32" && (extension === ".cmd" || extension === ".bat")
        ? "windows_script"
        : "native",
  };
}

async function isExecutableFile(
  path: string,
  platform: ExecutablePlatform,
): Promise<boolean> {
  try {
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function conventionalDirectories(
  platform: ExecutablePlatform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  const explicit = [
    env.PNPM_HOME,
    env.VOLTA_HOME ? join(env.VOLTA_HOME, "bin") : undefined,
    env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin") : undefined,
    env.UV_INSTALL_DIR,
  ];
  if (platform === "win32") {
    return compact([
      ...explicit,
      join(home, ".local", "bin"),
      env.APPDATA ? join(env.APPDATA, "npm") : undefined,
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "pnpm") : undefined,
      join(home, ".bun", "bin"),
      join(home, ".volta", "bin"),
      join(home, "scoop", "shims"),
      env.ChocolateyInstall ? join(env.ChocolateyInstall, "bin") : undefined,
      env.LOCALAPPDATA
        ? join(env.LOCALAPPDATA, "Microsoft", "WindowsApps")
        : undefined,
    ]);
  }
  return compact([
    ...explicit,
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".pyenv", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    platform === "darwin" ? join(home, "Library", "pnpm") : undefined,
    platform === "darwin" ? "/opt/homebrew/bin" : undefined,
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]);
}

async function versionManagerDirectories(
  platform: ExecutablePlatform,
  home: string,
): Promise<string[]> {
  if (platform === "win32") return [];
  const roots = [
    { root: join(home, ".nvm", "versions", "node"), suffix: ["bin"] },
    {
      root: join(home, ".fnm", "node-versions"),
      suffix: ["installation", "bin"],
    },
  ];
  const result: string[] = [];
  for (const { root, suffix } of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      result.push(
        ...entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(root, entry.name, ...suffix))
          .sort((left, right) =>
            right.localeCompare(left, undefined, { numeric: true }),
          ),
      );
    } catch {
      // Optional version-manager root.
    }
  }
  return result;
}

function environmentKey(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  return Object.keys(env).find((key) => key.toLowerCase() === target);
}

function environmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const key = environmentKey(env, name);
  return key ? env[key] : undefined;
}

function homeFromEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  return env.HOME ?? env.USERPROFILE;
}

function deduplicatePaths(
  paths: readonly (string | undefined)[],
  platform: ExecutablePlatform,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const path = raw?.trim();
    if (!path) continue;
    const key = platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function compact(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}
