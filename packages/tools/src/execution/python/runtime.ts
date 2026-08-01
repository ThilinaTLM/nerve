import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ExecutableLocatorOptions,
  locateExecutable,
  type ResolvedExecutable,
  runExecutable,
} from "../executable/executable.js";

export type PythonRuntimeSource = "manual" | "path" | "windows_launcher" | "uv";

export type PythonRuntime = {
  command: string;
  args: string[];
  displayPath: string;
  version?: string;
  source: PythonRuntimeSource;
};

export type PythonRuntimeStatus =
  | (PythonRuntime & { available: true })
  | {
      available: false;
      source: "unavailable";
      error: string;
    };

export type ResolvePythonRuntimeOptions = {
  cwd: string;
  manualPath?: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

type Candidate = {
  command: string;
  args: string[];
  source: PythonRuntimeSource;
  knownPaths?: string[];
};

type ProbeResult = {
  executable: string;
  version: string;
  versionInfo: [number, number, number];
};

const MIN_VERSION: [number, number] = [3, 9];

export async function resolvePythonRuntime(
  options: ResolvePythonRuntimeOptions,
): Promise<PythonRuntimeStatus> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const locatorOptions = executableLocatorOptions(options);
  let lastError = "No Python executable found.";

  if (options.manualPath?.trim()) {
    const manualPath = options.manualPath.trim();
    const executable = await locateExecutable(manualPath, locatorOptions);
    if (!executable) {
      return {
        available: false,
        source: "unavailable",
        error: `Python executable not found: ${manualPath}`,
      };
    }
    return await probeCandidate(
      executable,
      [],
      "manual",
      timeoutMs,
      options.env,
    );
  }

  const uvPython = await findUvPython(options, locatorOptions, timeoutMs);
  if (uvPython) {
    const executable = await locateExecutable(uvPython, locatorOptions);
    if (executable) {
      const status = await probeCandidate(
        executable,
        [],
        "uv",
        timeoutMs,
        options.env,
      );
      if (status.available) return status;
      lastError = status.error;
    }
  }

  for (const candidate of await pythonCandidates(options)) {
    const executable = await locateExecutable(candidate.command, {
      ...locatorOptions,
      additionalPaths: candidate.knownPaths,
    });
    if (!executable) continue;
    const status = await probeCandidate(
      executable,
      candidate.args,
      candidate.source,
      timeoutMs,
      options.env,
    );
    if (status.available) return status;
    lastError = status.error;
  }

  return { available: false, source: "unavailable", error: lastError };
}

async function findUvPython(
  options: ResolvePythonRuntimeOptions,
  locatorOptions: ExecutableLocatorOptions,
  timeoutMs: number,
): Promise<string | undefined> {
  const uv = await locateExecutable("uv", locatorOptions);
  if (!uv) return undefined;
  const result = await runExecutable(uv, ["python", "find", "--no-project"], {
    timeoutMs,
    cwd: options.cwd,
    env: { ...(options.env ?? process.env), UV_PYTHON_DOWNLOADS: "never" },
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function pythonCandidates(
  options: ResolvePythonRuntimeOptions,
): Promise<Candidate[]> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const knownPaths = await windowsPythonPaths(options);
    return [
      {
        command: "python.exe",
        args: [],
        source: "path",
        knownPaths,
      },
      { command: "python3.exe", args: [], source: "path" },
      { command: "py.exe", args: ["-3"], source: "windows_launcher" },
      { command: "py", args: ["-3"], source: "windows_launcher" },
    ];
  }

  const knownPaths =
    platform === "darwin"
      ? [
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          "/usr/bin/python3",
          "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
        ]
      : ["/usr/local/bin/python3", "/usr/bin/python3", "/bin/python3"];
  return [
    { command: "python3", args: [], source: "path", knownPaths },
    { command: "python", args: [], source: "path" },
  ];
}

async function windowsPythonPaths(
  options: ResolvePythonRuntimeOptions,
): Promise<string[]> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? env.USERPROFILE ?? env.HOME ?? homedir();
  const roots = [
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Python") : undefined,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value));
  const paths: string[] = [];
  for (const root of roots) {
    try {
      const directories = (await readdir(root, { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && /^Python3\d+/i.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, { numeric: true }),
        );
      paths.push(
        ...directories.map((directory) => join(root, directory, "python.exe")),
      );
    } catch {
      // Optional installation root.
    }
  }
  if (env.LOCALAPPDATA) {
    paths.push(
      join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "python.exe"),
    );
  }
  paths.push(join(home, ".local", "bin", "python.exe"));
  return paths;
}

async function probeCandidate(
  executable: ResolvedExecutable,
  args: string[],
  source: PythonRuntimeSource,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<PythonRuntimeStatus> {
  const probe = await probePython(executable, args, timeoutMs, env);
  if (!probe.ok) {
    return { available: false, source: "unavailable", error: probe.error };
  }
  if (!supportedVersion(probe.value.versionInfo)) {
    return {
      available: false,
      source: "unavailable",
      error: `Python ${probe.value.version} is too old; Python ${MIN_VERSION[0]}.${MIN_VERSION[1]}+ is required.`,
    };
  }
  return {
    available: true,
    command: executable.path,
    args,
    displayPath: probe.value.executable || executable.path,
    version: probe.value.version,
    source,
  };
}

async function probePython(
  executable: ResolvedExecutable,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; value: ProbeResult } | { ok: false; error: string }> {
  const script = [
    "import json, sys",
    "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0], 'versionInfo': list(sys.version_info[:3])}))",
  ].join("; ");
  const result = await runExecutable(executable, [...args, "-c", script], {
    timeoutMs,
    env,
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error:
        result.stderr.trim() ||
        result.error?.message ||
        `Python probe failed for ${executable.path} with status ${String(result.status)}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const versionInfo = Array.isArray(parsed.versionInfo)
      ? parsed.versionInfo.map(Number)
      : [];
    if (
      typeof parsed.executable !== "string" ||
      typeof parsed.version !== "string" ||
      versionInfo.length < 3 ||
      versionInfo.some((part) => !Number.isInteger(part))
    ) {
      return { ok: false, error: "Python probe returned invalid metadata." };
    }
    return {
      ok: true,
      value: {
        executable: parsed.executable,
        version: parsed.version,
        versionInfo: [versionInfo[0], versionInfo[1], versionInfo[2]],
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `Python probe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function supportedVersion([major, minor]: [number, number, number]): boolean {
  return (
    major > MIN_VERSION[0] ||
    (major === MIN_VERSION[0] && minor >= MIN_VERSION[1])
  );
}

function executableLocatorOptions(
  options: ResolvePythonRuntimeOptions,
): ExecutableLocatorOptions {
  return {
    platform: options.platform,
    env: options.env,
    homeDir: options.homeDir,
    cwd: options.cwd,
  };
}
