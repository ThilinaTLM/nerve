import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { buildProcessResult } from "../common/process-result.js";

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 600;

// Guardrails below block ordinary stdin/file-write/network APIs used by agent
// snippets. They are not a hard security sandbox against malicious Python code,
// native extensions, or interpreter internals.
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

STDIN_ERROR = "stdin is not available to the python tool."
FILEWRITE_ERROR = "file writes are disabled for the python tool in planning mode."
NETWORK_ERROR = "network access is disabled for the python tool."

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

def _deny_filewrite(*args, **kwargs):
    raise PermissionError(FILEWRITE_ERROR)

def _guarded_open_factory(original):
    def _guarded_open(file, mode="r", *args, **kwargs):
        if not allow_filewrite and _mode_writes(mode):
            raise PermissionError(FILEWRITE_ERROR)
        return original(file, mode, *args, **kwargs)
    return _guarded_open

def _install_filewrite_guards():
    if allow_filewrite:
        return

    builtins.open = _guarded_open_factory(builtins.open)
    io.open = _guarded_open_factory(io.open)

    _path_open = pathlib.Path.open
    def _guarded_path_open(self, mode="r", *args, **kwargs):
        if _mode_writes(mode):
            raise PermissionError(FILEWRITE_ERROR)
        return _path_open(self, mode, *args, **kwargs)
    pathlib.Path.open = _guarded_path_open

    for name in ("write_text", "write_bytes", "mkdir", "unlink", "rename", "replace", "rmdir", "touch"):
        if hasattr(pathlib.Path, name):
            setattr(pathlib.Path, name, _deny_filewrite)

    for module, names in (
        (os, ("remove", "unlink", "rmdir", "rename", "replace", "mkdir", "makedirs", "removedirs", "truncate")),
        (shutil, ("rmtree", "move", "copy", "copy2", "copyfile", "copytree")),
    ):
        for name in names:
            if hasattr(module, name):
                setattr(module, name, _deny_filewrite)

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
            mode = args[1] if len(args) > 1 else None
            flags = args[2] if len(args) > 2 else 0
            if _mode_writes(mode) or _flags_write(flags):
                raise PermissionError(FILEWRITE_ERROR)
        elif event in {
            "os.remove",
            "os.rmdir",
            "os.rename",
            "os.replace",
            "os.mkdir",
            "os.truncate",
            "shutil.rmtree",
            "subprocess.Popen",
        }:
            raise PermissionError(FILEWRITE_ERROR)
    if not allow_network and event.startswith("socket."):
        raise PermissionError(NETWORK_ERROR)

try:
    sys.addaudithook(_audit)
except Exception:
    pass

_install_filewrite_guards()
_install_network_guards()
runpy.run_path(user_path, run_name="__main__")
`;

export async function executePython(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.code !== "string" || args.code.trim().length === 0) {
    throw new Error("Tool argument 'code' must be a non-empty string.");
  }
  const runtime = context.pythonRuntime;
  if (!runtime) throw new Error("Python runtime is not available.");

  const timeoutSeconds = clampTimeout(args.timeout);
  const policy = context.pythonPolicy ?? {
    allowNetwork: true,
    allowFileWrite: true,
  };

  const tempDir = await mkdtemp(join(tmpdir(), "nerve-python-"));
  const runnerPath = join(tempDir, "runner.py");
  const userPath = join(tempDir, "user.py");
  await Promise.all([
    writeFile(runnerPath, RUNNER_SOURCE, "utf8"),
    writeFile(userPath, args.code, "utf8"),
  ]);

  try {
    return await runPythonProcess({
      runtime,
      policy,
      timeoutSeconds,
      cwd: context.cwd,
      runnerPath,
      userPath,
      signal: context.signal,
      onUpdate: context.onUpdate,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type RunPythonProcessOptions = {
  runtime: NonNullable<ToolExecutionContext["pythonRuntime"]>;
  policy: NonNullable<ToolExecutionContext["pythonPolicy"]>;
  timeoutSeconds: number;
  cwd: string;
  runnerPath: string;
  userPath: string;
  signal?: AbortSignal;
  onUpdate?: ToolExecutionContext["onUpdate"];
};

async function runPythonProcess({
  runtime,
  policy,
  timeoutSeconds,
  cwd,
  runnerPath,
  userPath,
  signal,
  onUpdate,
}: RunPythonProcessOptions): Promise<ToolExecutionResult> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const combinedChunks: Buffer[] = [];

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Python execution aborted."));
      return;
    }

    const child = spawn(
      runtime.command,
      [
        ...runtime.args,
        "-u",
        "-B",
        runnerPath,
        userPath,
        JSON.stringify(policy),
      ],
      {
        cwd,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONDONTWRITEBYTECODE: "1",
          NERVE_PYTHON_ALLOW_NETWORK: policy.allowNetwork ? "1" : "0",
          NERVE_PYTHON_ALLOW_FILEWRITE: policy.allowFileWrite ? "1" : "0",
        },
      },
    );

    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        child.kill("SIGTERM");
      }
    };
    const onAbort = () => {
      if (settled) return;
      kill();
      settled = true;
      cleanup();
      reject(new Error("Python execution aborted."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      if (settled) return;
      kill();
      settled = true;
      cleanup();
      reject(new Error(`Python execution timed out after ${timeoutSeconds}s.`));
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      combinedChunks.push(chunk);
      onUpdate?.({
        kind: "output",
        stream: "stdout",
        chunk: chunk.toString("utf8"),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      combinedChunks.push(chunk);
      onUpdate?.({
        kind: "output",
        stream: "stderr",
        chunk: chunk.toString("utf8"),
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
      void buildProcessResult({
        stdoutChunks,
        stderrChunks,
        combinedChunks,
        code,
        signal: closeSignal,
        outputFilePrefix: "nerve-python",
        exitMessagePrefix: "Python",
        details: {
          executable: runtime.displayPath,
          version: runtime.version,
          timeoutSeconds,
          allowNetwork: policy.allowNetwork,
          allowFileWrite: policy.allowFileWrite,
        },
      })
        .then(resolve)
        .catch(reject);
    });
  });
}

function clampTimeout(value: unknown): number {
  if (typeof value !== "number") return DEFAULT_TIMEOUT_SECONDS;
  const seconds = numberArg(value, DEFAULT_TIMEOUT_SECONDS);
  if (seconds <= 0) return DEFAULT_TIMEOUT_SECONDS;
  return Math.min(seconds, MAX_TIMEOUT_SECONDS);
}
