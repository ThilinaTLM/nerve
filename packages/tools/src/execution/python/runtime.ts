import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
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
};

type Candidate = {
  command: string;
  args: string[];
  source: PythonRuntimeSource;
  mustExist?: boolean;
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
  const candidates = await pythonCandidates(options.cwd, options.manualPath);
  let lastError = "No Python executable found.";

  for (const candidate of candidates) {
    if (candidate.mustExist && !(await pathExists(candidate.command))) {
      lastError = `Python executable not found: ${candidate.command}`;
      continue;
    }
    const probe = await probePython(
      candidate.command,
      candidate.args,
      timeoutMs,
    );
    if (!probe.ok) {
      lastError = probe.error;
      continue;
    }
    if (!supportedVersion(probe.value.versionInfo)) {
      lastError = `Python ${probe.value.version} is too old; Python ${MIN_VERSION[0]}.${MIN_VERSION[1]}+ is required.`;
      continue;
    }
    return {
      available: true,
      command: candidate.command,
      args: candidate.args,
      displayPath: probe.value.executable || candidate.command,
      version: probe.value.version,
      source: candidate.source,
    };
  }

  return { available: false, source: "unavailable", error: lastError };
}

async function pythonCandidates(
  cwd: string,
  manualPath?: string,
): Promise<Candidate[]> {
  if (manualPath?.trim()) {
    return [
      {
        command: manualPath.trim(),
        args: [],
        source: "manual",
        mustExist: true,
      },
    ];
  }

  const candidates: Candidate[] = [];
  const uvPython = await findUvPython(cwd);
  if (uvPython) {
    candidates.push({
      command: uvPython,
      args: [],
      source: "uv",
      mustExist: true,
    });
  }

  if (process.platform === "win32") {
    candidates.push(
      { command: "python.exe", args: [], source: "path" },
      { command: "python3.exe", args: [], source: "path" },
      { command: "py.exe", args: ["-3"], source: "windows_launcher" },
      { command: "py", args: ["-3"], source: "windows_launcher" },
    );
  } else {
    candidates.push(
      { command: "python3", args: [], source: "path" },
      { command: "python", args: [], source: "path" },
    );
  }

  return candidates;
}

async function findUvPython(cwd: string): Promise<string | undefined> {
  const result = await runCommand(
    "uv",
    ["python", "find", "--no-project"],
    5000,
    cwd,
    {
      UV_PYTHON_DOWNLOADS: "never",
    },
  );
  if (result.status !== 0) return undefined;
  const first = result.stdout.trim().split(/\r?\n/)[0]?.trim();
  return first || undefined;
}

async function probePython(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: true; value: ProbeResult } | { ok: false; error: string }> {
  const script = [
    "import json, sys",
    "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0], 'versionInfo': list(sys.version_info[:3])}))",
  ].join("; ");
  const result = await runCommand(command, [...args, "-c", script], timeoutMs);
  if (result.status !== 0) {
    return {
      ok: false,
      error:
        result.stderr.trim() ||
        `Python probe failed for ${command} with status ${String(result.status)}`,
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
      return { ok: false, error: `Python probe returned invalid metadata.` };
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

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(env ?? {}) },
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr: error.message, status: null });
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, status });
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
