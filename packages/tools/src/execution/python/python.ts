import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { resolveCommandCwd } from "../common/command-cwd.js";
import { boundLiveOutputChunk } from "../common/output-budget.js";
import { forceKillProcessTree } from "../common/process-tree.js";
import { buildProcessResult } from "../common/process-result.js";
import { pathNotFoundMessage, resolveToolPath } from "../filesystem/path.js";

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 600;
const FORCE_KILL_AFTER_MS = 2000;
const MAX_ARTIFACTS = 100;
const SENSITIVE_ENV_KEY_PATTERN =
  /authorization|cookie|token|apikey|api_key|password|passwd|secret|credential|private.?key|nerve_daemon_token/i;

// Guardrails below block ordinary stdin/file-write/network APIs used by agent
// snippets. They are not a hard security sandbox against malicious Python code,
// native extensions, interpreter internals, or symlink tricks.
const RUNNER_SOURCE = `
import builtins
import io
import json
import os
import pathlib
import runpy
import shutil
import socket
import subprocess
import sys

user_path = sys.argv[1]
policy = json.loads(sys.argv[2])
allow_network = bool(policy.get("allowNetwork", True))
allow_filewrite = bool(policy.get("allowFileWrite", True))
artifact_dir_value = policy.get("artifactDir")
artifact_dir = os.path.abspath(artifact_dir_value) if isinstance(artifact_dir_value, str) and artifact_dir_value else None

STDIN_ERROR = "stdin is not available to the python_exec tool."
FILEWRITE_ERROR = "file writes are disabled for the python_exec tool in planning mode. Write generated artifacts under NERVE_PYTHON_ARTIFACT_DIR instead."
NETWORK_ERROR = "network access is disabled for the python_exec tool."

class _NoStdin:
    encoding = "utf-8"
    errors = "strict"
    closed = False

    def read(self, *args, **kwargs):
        raise RuntimeError(STDIN_ERROR)

    def readline(self, *args, **kwargs):
        raise RuntimeError(STDIN_ERROR)

    def readlines(self, *args, **kwargs):
        raise RuntimeError(STDIN_ERROR)

    def __iter__(self):
        raise RuntimeError(STDIN_ERROR)

    def fileno(self):
        raise RuntimeError(STDIN_ERROR)

    def isatty(self):
        return False

    def readable(self):
        return False

    def writable(self):
        return False

    def seekable(self):
        return False

builtins.input = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError(STDIN_ERROR))
sys.stdin = _NoStdin()

_WRITE_MODE_CHARS = set("wax+")
_WRITE_FLAG_BITS = 0
for _name in ("O_WRONLY", "O_RDWR", "O_CREAT", "O_TRUNC", "O_APPEND"):
    _WRITE_FLAG_BITS |= int(getattr(os, _name, 0) or 0)

def _mode_writes(mode):
    if mode is None:
        return False
    return any(ch in str(mode) for ch in _WRITE_MODE_CHARS)

def _flags_write(flags):
    try:
        return (int(flags) & _WRITE_FLAG_BITS) != 0
    except Exception:
        return False

def _path_in_artifact(path):
    if artifact_dir is None:
        return False
    try:
        target = os.path.abspath(os.fspath(path))
    except Exception:
        return False
    try:
        return os.path.commonpath([artifact_dir, target]) == artifact_dir
    except Exception:
        return False

def _check_filewrite_target(path):
    if allow_filewrite:
        return
    if _path_in_artifact(path):
        return
    raise PermissionError(FILEWRITE_ERROR)

def _deny_filewrite(*args, **kwargs):
    raise PermissionError(FILEWRITE_ERROR)

def _guarded_open_factory(original):
    def _guarded_open(file, mode="r", *args, **kwargs):
        if not allow_filewrite and _mode_writes(mode):
            _check_filewrite_target(file)
        return original(file, mode, *args, **kwargs)
    return _guarded_open

def _guarded_path_method(original):
    def _guarded(self, *args, **kwargs):
        _check_filewrite_target(self)
        return original(self, *args, **kwargs)
    return _guarded

def _guarded_path_move(original):
    def _guarded(self, target, *args, **kwargs):
        _check_filewrite_target(self)
        _check_filewrite_target(target)
        return original(self, target, *args, **kwargs)
    return _guarded

def _guarded_os_one(original):
    def _guarded(path, *args, **kwargs):
        _check_filewrite_target(path)
        return original(path, *args, **kwargs)
    return _guarded

def _guarded_os_two(original):
    def _guarded(src, dst, *args, **kwargs):
        _check_filewrite_target(src)
        _check_filewrite_target(dst)
        return original(src, dst, *args, **kwargs)
    return _guarded

def _guarded_shutil_copy(original):
    def _guarded(src, dst, *args, **kwargs):
        _check_filewrite_target(dst)
        return original(src, dst, *args, **kwargs)
    return _guarded

def _install_filewrite_guards():
    if allow_filewrite:
        return

    builtins.open = _guarded_open_factory(builtins.open)
    io.open = _guarded_open_factory(io.open)

    _path_open = pathlib.Path.open
    def _guarded_path_open(self, mode="r", *args, **kwargs):
        if _mode_writes(mode):
            _check_filewrite_target(self)
        return _path_open(self, mode, *args, **kwargs)
    pathlib.Path.open = _guarded_path_open

    for name in ("write_text", "write_bytes", "mkdir", "unlink", "rmdir", "touch"):
        if hasattr(pathlib.Path, name):
            setattr(pathlib.Path, name, _guarded_path_method(getattr(pathlib.Path, name)))
    for name in ("rename", "replace"):
        if hasattr(pathlib.Path, name):
            setattr(pathlib.Path, name, _guarded_path_move(getattr(pathlib.Path, name)))

    for module, names in (
        (os, ("remove", "unlink", "rmdir", "mkdir", "makedirs", "removedirs", "truncate")),
    ):
        for name in names:
            if hasattr(module, name):
                setattr(module, name, _guarded_os_one(getattr(module, name)))
    for name in ("rename", "replace"):
        if hasattr(os, name):
            setattr(os, name, _guarded_os_two(getattr(os, name)))

    for name in ("copy", "copy2", "copyfile", "copytree"):
        if hasattr(shutil, name):
            setattr(shutil, name, _guarded_shutil_copy(getattr(shutil, name)))
    for name in ("move",):
        if hasattr(shutil, name):
            setattr(shutil, name, _guarded_os_two(getattr(shutil, name)))
    for name in ("rmtree",):
        if hasattr(shutil, name):
            setattr(shutil, name, _guarded_os_one(getattr(shutil, name)))

    def _blocked_popen(*args, **kwargs):
        raise PermissionError(FILEWRITE_ERROR)
    subprocess.Popen = _blocked_popen
    subprocess.run = _blocked_popen
    subprocess.call = _blocked_popen
    subprocess.check_call = _blocked_popen
    subprocess.check_output = _blocked_popen

def _install_network_guards():
    if allow_network:
        return

    class _BlockedSocket(socket.socket):
        def __init__(self, *args, **kwargs):
            raise PermissionError(NETWORK_ERROR)

    def _blocked_create_connection(*args, **kwargs):
        raise PermissionError(NETWORK_ERROR)

    socket.socket = _BlockedSocket
    socket.create_connection = _blocked_create_connection

def _audit(event, args):
    if not allow_filewrite:
        if event == "open":
            path = args[0] if len(args) > 0 else None
            mode = args[1] if len(args) > 1 else None
            flags = args[2] if len(args) > 2 else 0
            if _mode_writes(mode) or _flags_write(flags):
                _check_filewrite_target(path)
        elif event in {
            "os.remove",
            "os.rmdir",
            "os.mkdir",
            "os.truncate",
            "shutil.rmtree",
        }:
            path = args[0] if len(args) > 0 else None
            _check_filewrite_target(path)
        elif event in {"os.rename", "os.replace"}:
            src = args[0] if len(args) > 0 else None
            dst = args[1] if len(args) > 1 else None
            _check_filewrite_target(src)
            _check_filewrite_target(dst)
        elif event == "subprocess.Popen":
            raise PermissionError(FILEWRITE_ERROR)
    if not allow_network and event.startswith("socket."):
        raise PermissionError(NETWORK_ERROR)

try:
    sys.addaudithook(_audit)
except Exception:
    pass

_install_filewrite_guards()
_install_network_guards()
user_dir = os.path.dirname(os.path.abspath(user_path))
if user_dir:
    sys.path.insert(0, user_dir)
runpy.run_path(user_path, run_name="__main__")
`;

export async function executePython(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const cwd = await resolveCommandCwd(context.cwd, args.cwd);
  const source = await pythonSourceArg(args, cwd);
  const runtime = context.pythonRuntime;
  if (!runtime) throw new Error("Python runtime is not available.");

  const timeoutSeconds = clampTimeout(args.timeout);
  const envOverrides = envOverridesArg(args.env);
  const policy = context.pythonPolicy ?? {
    allowNetwork: true,
    allowFileWrite: true,
  };

  const tempDir = await mkdtemp(join(tmpdir(), "nerve-python-"));
  const artifactDir = await createArtifactDir(context.dataDir);
  let keepArtifactDir = false;
  const runnerPath = join(tempDir, "runner.py");
  const userPath =
    source.kind === "inline" ? join(tempDir, "user.py") : source.path;
  if (source.kind === "inline") {
    await Promise.all([
      writeFile(runnerPath, RUNNER_SOURCE, "utf8"),
      writeFile(userPath, source.code, "utf8"),
    ]);
  } else {
    await writeFile(runnerPath, RUNNER_SOURCE, "utf8");
  }

  try {
    const result = await runPythonProcess({
      runtime,
      policy,
      timeoutSeconds,
      cwd,
      runnerPath,
      userPath,
      artifactDir,
      envOverrides,
      inputMode: source.kind,
      scriptPath: source.kind === "file" ? source.path : undefined,
      dataDir: context.dataDir,
      signal: context.signal,
      onUpdate: context.onUpdate,
    });
    keepArtifactDir = artifactCount(result) > 0;
    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    if (!keepArtifactDir) {
      await rm(artifactDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

type RunPythonProcessOptions = {
  runtime: NonNullable<ToolExecutionContext["pythonRuntime"]>;
  policy: NonNullable<ToolExecutionContext["pythonPolicy"]>;
  timeoutSeconds: number;
  cwd: string;
  runnerPath: string;
  userPath: string;
  artifactDir: string;
  envOverrides: Record<string, string>;
  inputMode: PythonSource["kind"];
  scriptPath?: string;
  dataDir?: string;
  signal?: AbortSignal;
  onUpdate?: ToolExecutionContext["onUpdate"];
};

type PythonArtifact = {
  path: string;
  size: number;
};

async function runPythonProcess({
  runtime,
  policy,
  timeoutSeconds,
  cwd,
  runnerPath,
  userPath,
  artifactDir,
  envOverrides,
  inputMode,
  scriptPath,
  dataDir,
  signal,
  onUpdate,
}: RunPythonProcessOptions): Promise<ToolExecutionResult> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const combinedChunks: Buffer[] = [];
  const startedAt = performance.now();

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Python execution aborted."));
      return;
    }

    const runnerPolicy = {
      ...policy,
      artifactDir,
    };
    const child = spawn(
      runtime.command,
      [
        ...runtime.args,
        "-u",
        "-B",
        runnerPath,
        userPath,
        JSON.stringify(runnerPolicy),
      ],
      {
        cwd,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...envOverrides,
          PYTHONIOENCODING: "utf-8",
          PYTHONDONTWRITEBYTECODE: "1",
          NERVE_PYTHON_ALLOW_NETWORK: policy.allowNetwork ? "1" : "0",
          NERVE_PYTHON_ALLOW_FILEWRITE: policy.allowFileWrite ? "1" : "0",
          NERVE_PYTHON_ARTIFACT_DIR: artifactDir,
        },
      },
    );

    let settled = false;
    let timedOut = false;
    let timeoutKilled = false;
    // eslint-disable-next-line prefer-const -- Cleanup closes over the timer before it is scheduled.
    let timeout: NodeJS.Timeout | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const killPosix = (killSignal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch {
        child.kill(killSignal);
      }
    };
    const rejectTerminationFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Failed to terminate Python process tree: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void forceKillProcessTree(child).then(
        () => reject(new Error("Python execution aborted.")),
        () =>
          reject(
            new Error(
              "Python execution aborted after process termination failed.",
            ),
          ),
      );
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      timeoutKilled = true;
      if (process.platform === "win32") {
        void forceKillProcessTree(child).catch(rejectTerminationFailure);
        return;
      }
      killPosix("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        if (!settled) {
          void forceKillProcessTree(child).catch(rejectTerminationFailure);
        }
      }, FORCE_KILL_AFTER_MS);
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      combinedChunks.push(chunk);
      onUpdate?.({
        kind: "output",
        stream: "stdout",
        chunk: boundLiveOutputChunk(chunk.toString("utf8")),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      combinedChunks.push(chunk);
      onUpdate?.({
        kind: "output",
        stream: "stderr",
        chunk: boundLiveOutputChunk(chunk.toString("utf8")),
      });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const durationMs = Math.round(performance.now() - startedAt);
      void listArtifacts(artifactDir)
        .then((artifacts) =>
          buildProcessResult({
            stdoutChunks,
            stderrChunks,
            combinedChunks,
            code,
            signal: closeSignal,
            outputFilePrefix: "nerve-python",
            exitMessagePrefix: "Python",
            dataDir,
            durationMs,
            timedOut,
            timeoutKilled,
            timeoutMessage: `Python timed out after ${timeoutSeconds}s and ${timeoutKilled ? "was killed" : "was not killed"}.`,
            contentFooterLines: artifactFooterLines(artifacts),
            details: {
              executable: runtime.displayPath,
              version: runtime.version,
              timeoutSeconds,
              allowNetwork: policy.allowNetwork,
              allowFileWrite: policy.allowFileWrite,
              envKeys: Object.keys(envOverrides).sort(),
              inputMode,
              scriptPath,
              artifactDir: artifacts.length > 0 ? artifactDir : undefined,
              artifacts,
            },
          }),
        )
        .then(resolve)
        .catch(reject);
    });
  });
}

type PythonSource =
  | { kind: "inline"; code: string }
  | { kind: "file"; path: string };

async function pythonSourceArg(
  args: Record<string, unknown>,
  cwd: string,
): Promise<PythonSource> {
  const hasCode = args.code !== undefined;
  const hasPath = args.path !== undefined;
  if (hasCode && hasPath) {
    throw new Error("Provide exactly one of tool arguments 'code' or 'path'.");
  }
  if (!hasCode && !hasPath) {
    throw new Error("Provide exactly one of tool arguments 'code' or 'path'.");
  }

  if (hasCode) {
    if (typeof args.code !== "string" || args.code.trim().length === 0) {
      throw new Error("Tool argument 'code' must be a non-empty string.");
    }
    return { kind: "inline", code: args.code };
  }

  if (typeof args.path !== "string" || args.path.trim().length === 0) {
    throw new Error("Tool argument 'path' must be a non-empty string.");
  }
  const path = resolveToolPath(cwd, args.path);
  const info = await stat(path).catch((error: unknown) => {
    throw new Error(
      pathNotFoundMessage("python_exec", args.path, path),
      error instanceof Error ? { cause: error } : undefined,
    );
  });
  if (!info.isFile()) {
    throw new Error(
      `Tool argument 'path' must point to a Python script file: ${path}`,
    );
  }
  return { kind: "file", path };
}

function clampTimeout(value: unknown): number {
  if (typeof value !== "number") return DEFAULT_TIMEOUT_SECONDS;
  const seconds = numberArg(value, DEFAULT_TIMEOUT_SECONDS);
  if (seconds <= 0) return DEFAULT_TIMEOUT_SECONDS;
  return Math.min(seconds, MAX_TIMEOUT_SECONDS);
}

function envOverridesArg(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool argument 'env' must be an object of string values.");
  }
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") {
      throw new Error(
        "Tool argument 'env' must be an object of string values.",
      );
    }
    if (raw.includes("\0")) {
      throw new Error("Tool argument 'env' contains an invalid value.");
    }
    if (key.length === 0 || key.includes("=") || key.includes("\0")) {
      throw new Error(
        "Tool argument 'env' contains an invalid environment key.",
      );
    }
    if (SENSITIVE_ENV_KEY_PATTERN.test(key)) {
      throw new Error(
        `Tool argument 'env' contains sensitive-looking key '${key}'. The python_exec tool only accepts non-secret env overrides.`,
      );
    }
    output[key] = raw;
  }
  return output;
}

async function createArtifactDir(dataDir: string | undefined): Promise<string> {
  const baseDir = dataDir
    ? join(dataDir, "tmp", "python-artifacts")
    : join(tmpdir(), "nerve-python-artifacts");
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  return await mkdtemp(join(baseDir, "run-"));
}

async function listArtifacts(root: string): Promise<PythonArtifact[]> {
  const artifacts: PythonArtifact[] = [];
  await visitArtifactDir(root, artifacts).catch(() => undefined);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

async function visitArtifactDir(
  dir: string,
  artifacts: PythonArtifact[],
): Promise<void> {
  if (artifacts.length >= MAX_ARTIFACTS) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (artifacts.length >= MAX_ARTIFACTS) return;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await visitArtifactDir(path, artifacts);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(path).catch(() => undefined);
    artifacts.push({ path, size: info?.size ?? 0 });
  }
}

function artifactFooterLines(artifacts: PythonArtifact[]): string[] {
  if (artifacts.length === 0) return [];
  const lines = [
    `Python artifacts (${artifacts.length}):`,
    ...artifacts.map(
      (artifact) => `- ${artifact.path} (${formatArtifactSize(artifact.size)})`,
    ),
  ];
  if (artifacts.length >= MAX_ARTIFACTS) {
    lines.push(`- ... artifact list capped at ${MAX_ARTIFACTS} files`);
  }
  return lines;
}

function artifactCount(result: ToolExecutionResult): number {
  const details = result.details;
  if (!details || typeof details !== "object") return 0;
  const artifacts = (details as { artifacts?: unknown }).artifacts;
  return Array.isArray(artifacts) ? artifacts.length : 0;
}

function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
