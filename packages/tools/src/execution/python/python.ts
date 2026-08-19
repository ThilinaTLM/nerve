import { randomUUID } from "node:crypto";
import {
  ExecutionWorkerClient,
  spawnManagedChildProcess,
  terminateManagedChildProcess,
} from "@nervekit/native";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { resolveCommandCwd } from "../common/command-cwd.js";
import { BoundedProcessOutput } from "../common/bounded-process-output.js";
import { LiveOutputDelivery } from "../common/live-output.js";
import { forceKillProcessTree } from "../common/process-tree.js";
import { buildProcessResult } from "../common/process-result.js";
import { pathNotFoundMessage, resolveToolPath } from "../filesystem/path.js";
import { RUNNER_SOURCE } from "./python-runner-source.js";

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 600;
const FORCE_KILL_AFTER_MS = 2000;
const MAX_ARTIFACTS = 100;
const SENSITIVE_ENV_KEY_PATTERN =
  /authorization|cookie|token|apikey|api_key|password|passwd|secret|credential|private.?key|nerve_daemon_token/i;

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

  const durableExecutionDir =
    context.executionId && context.dataDir
      ? join(
          context.dataDir,
          "execution-runtime",
          "executions",
          context.executionId,
        )
      : undefined;
  const tempDir = durableExecutionDir
    ? join(durableExecutionDir, "python-input")
    : await mkdtemp(join(tmpdir(), "nerve-python-"));
  if (durableExecutionDir) {
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
  }
  const artifactDir = await createArtifactDir(
    context.dataDir,
    durableExecutionDir,
  );
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
      executionId: context.executionId,
      signal: context.signal,
      onUpdate: context.onUpdate,
    });
    keepArtifactDir = artifactCount(result) > 0;
    return result;
  } finally {
    if (!durableExecutionDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (!keepArtifactDir && !durableExecutionDir) {
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
  executionId?: string;
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
  executionId,
  signal,
  onUpdate,
}: RunPythonProcessOptions): Promise<ToolExecutionResult> {
  if (dataDir) {
    return runPythonProcessInWorker({
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
      executionId,
      signal,
      onUpdate,
    });
  }
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
    const child = spawnManagedChildProcess(
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

    const liveOutput = new LiveOutputDelivery(onUpdate);
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
    const terminateGracefully = () => {
      void terminateManagedChildProcess(child, "SIGTERM").then((result) => {
        if (!result || result.error) {
          rejectTerminationFailure(
            result?.error ?? "Native managed process metadata is unavailable",
          );
        }
      }, rejectTerminationFailure);
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
      terminateGracefully();
      forceKillTimeout = setTimeout(() => {
        if (!settled) {
          void forceKillProcessTree(child).catch(rejectTerminationFailure);
        }
      }, FORCE_KILL_AFTER_MS);
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      combinedChunks.push(chunk);
      liveOutput.write("stdout", chunk, child.stdout ?? undefined);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      combinedChunks.push(chunk);
      liveOutput.write("stderr", chunk, child.stderr ?? undefined);
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
      void liveOutput
        .end()
        .then(() => listArtifacts(artifactDir))
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

async function runPythonProcessInWorker(
  options: RunPythonProcessOptions & { dataDir: string },
): Promise<ToolExecutionResult> {
  if (options.signal?.aborted) throw new Error("Python execution aborted.");
  const worker = await ExecutionWorkerClient.connect(options.dataDir);
  const executionId = options.executionId ?? `python_${randomUUID()}`;
  const output = new BoundedProcessOutput();
  const liveOutput = new LiveOutputDelivery(options.onUpdate);
  const startedAt = performance.now();
  const runnerPolicy = { ...options.policy, artifactDir: options.artifactDir };
  const onAbort = () => {
    void worker.cancel(executionId, "SIGKILL").catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const existing = options.executionId
      ? await worker.get(executionId)
      : undefined;
    if (!existing)
      await worker.start({
        executionId,
        command: options.runtime.command,
        args: [
          ...options.runtime.args,
          "-u",
          "-B",
          options.runnerPath,
          options.userPath,
          JSON.stringify(runnerPolicy),
        ],
        cwd: options.cwd,
        env: Object.fromEntries(
          Object.entries({
            ...process.env,
            ...options.envOverrides,
            PYTHONIOENCODING: "utf-8",
            PYTHONDONTWRITEBYTECODE: "1",
            NERVE_PYTHON_ALLOW_NETWORK: options.policy.allowNetwork ? "1" : "0",
            NERVE_PYTHON_ALLOW_FILEWRITE: options.policy.allowFileWrite
              ? "1"
              : "0",
            NERVE_PYTHON_ARTIFACT_DIR: options.artifactDir,
          }).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        timeoutMs: options.timeoutSeconds * 1_000,
        terminationGraceMs: FORCE_KILL_AFTER_MS,
        belowNormalPriority: true,
      });
    const terminal = await worker.subscribe(executionId, {
      signal: options.signal,
      onOutput: (stream, chunk) => {
        output.push(stream, chunk);
        liveOutput.write(stream, chunk);
      },
    }).settled;
    await liveOutput.end();
    const artifacts = await listArtifacts(options.artifactDir);
    const snapshot = output.snapshot();
    const timedOut =
      performance.now() - startedAt >= options.timeoutSeconds * 1_000 &&
      terminal.status === "failed";
    return await buildProcessResult({
      stdoutChunks: snapshot.stdoutChunks,
      stderrChunks: snapshot.stderrChunks,
      combinedChunks: snapshot.combinedChunks,
      code: terminal.exitCode ?? null,
      signal: (terminal.signal as NodeJS.Signals | undefined) ?? null,
      outputFilePrefix: "nerve-python",
      exitMessagePrefix: "Python",
      dataDir: options.dataDir,
      durationMs: Math.round(performance.now() - startedAt),
      timedOut,
      timeoutKilled: timedOut,
      timeoutMessage: timedOut
        ? `Python timed out after ${options.timeoutSeconds}s and was killed.`
        : undefined,
      contentFooterLines: artifactFooterLines(artifacts),
      details: {
        executable: options.runtime.displayPath,
        version: options.runtime.version,
        timeoutSeconds: options.timeoutSeconds,
        allowNetwork: options.policy.allowNetwork,
        allowFileWrite: options.policy.allowFileWrite,
        envKeys: Object.keys(options.envOverrides).sort(),
        inputMode: options.inputMode,
        scriptPath: options.scriptPath,
        artifactDir: artifacts.length > 0 ? options.artifactDir : undefined,
        artifacts,
        outputRetention: {
          totalBytes: snapshot.totalBytes,
          retainedBytes: snapshot.retainedBytes,
          omittedBytes: snapshot.omittedBytes,
          truncated: snapshot.truncated,
        },
      },
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new Error("Python execution aborted.", { cause: error });
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (!options.executionId) {
      void worker.remove(executionId).catch(() => undefined);
    }
  }
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

async function createArtifactDir(
  dataDir: string | undefined,
  durableExecutionDir?: string,
): Promise<string> {
  if (durableExecutionDir) {
    const artifactDir = join(durableExecutionDir, "python-artifacts");
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    return artifactDir;
  }
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
