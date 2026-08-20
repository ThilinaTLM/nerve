export {
  ExecutionWorkerClient,
  executionWorkerFilename,
  isRetryableConnectionError,
  resolveExecutionWorkerPath,
  type WorkerEndpoint,
  type ExecutionOutputSubscription,
} from "./execution-worker-client.js";

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export type NativeContainment = "job-object" | "process-group";
export type TerminationMethod =
  | "job-object"
  | "process-group"
  | "process-tree"
  | "direct-child"
  | "none";

export interface ManagedTarget {
  pid: number;
  processGroupId?: number;
  containment: NativeContainment;
  identity: string;
}

export type InspectionResult =
  | { evidence: "alive_verified"; detail?: string }
  | { evidence: "exited_verified"; detail?: string }
  | { evidence: "identity_mismatch"; detail?: string }
  | { evidence: "unknown"; detail: string };

export interface TerminationResult {
  attempted: boolean;
  terminated: boolean;
  method: TerminationMethod;
  error?: string;
}

export interface ManagedProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
  readonly target: ManagedTarget;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exited: Promise<ManagedProcessExit>;
  readonly closed: Promise<ManagedProcessExit>;
  terminate(signal?: NodeJS.Signals): Promise<TerminationResult>;
}

export interface ManagedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface NativeProcessHandle {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
  readonly processGroupId?: number;
  readonly target: ManagedTarget;
  terminate(signal?: string): TerminationResult;
}

export interface NativeToolCallScanFile {
  conversationId: string;
  toolCallId: string;
  bytes: Buffer;
}

export interface NativeToolCallScanBatch {
  files: NativeToolCallScanFile[];
  bytes: number;
  done: boolean;
}

interface NativeToolCallScannerBinding {
  nextBatch(
    maxFiles: number,
    maxBytes: number,
  ): Promise<NativeToolCallScanBatch>;
}

interface NativeBinding {
  NativeToolCallScanner: new (home: string) => NativeToolCallScannerBinding;
  inspectManagedTarget(target: ManagedTarget): InspectionResult;
  readGitRepositoryInfo(path: string): Promise<NativeGitRepositoryInfoResult>;
  readGitSnapshot(
    path: string,
    options?: NativeGitSnapshotOptions,
  ): Promise<NativeGitSnapshotResult>;
  checkGitAncestry(
    path: string,
    ancestor: string,
    descendant: string,
  ): Promise<NativeGitAncestryResult>;
  resolveGitRevision(
    path: string,
    revision: string,
  ): Promise<NativeGitRevisionResult>;
  readGitFileDiff(
    path: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiffResult>;
  validateGitBranchName(name: string): boolean;
  terminateManagedTarget(
    target: ManagedTarget,
    signal?: string,
  ): TerminationResult;
  runtimeCapabilities(): { platform: string; capabilities: string[] };
  spawnManagedProcess(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> },
    stdout: (error: Error | null, chunk: Buffer) => void,
    stderr: (error: Error | null, chunk: Buffer) => void,
    exit: (error: Error | null, result: [number, string]) => void,
    close: (error: Error | null, result: [number, string]) => void,
  ): NativeProcessHandle;
}

const binding = loadBinding();
export class CanonicalToolCallScanner {
  private readonly scanner: NativeToolCallScannerBinding;

  constructor(home: string) {
    this.scanner = new binding.NativeToolCallScanner(home);
  }

  nextBatch(
    maxFiles = 256,
    maxBytes = 4 * 1024 * 1024,
  ): Promise<NativeToolCallScanBatch> {
    if (!Number.isInteger(maxFiles) || maxFiles <= 0)
      throw new Error("maxFiles must be a positive integer.");
    if (!Number.isInteger(maxBytes) || maxBytes <= 0)
      throw new Error("maxBytes must be a positive integer.");
    return this.scanner.nextBatch(maxFiles, maxBytes);
  }
}

const childProcesses = new WeakMap<ChildProcess, ManagedProcess>();

export type NativeGitErrorCategory =
  | "not_repository"
  | "not_found"
  | "unsupported"
  | "invalid_input"
  | "io"
  | "corrupt"
  | "limit_exceeded"
  | "cancelled"
  | "internal";

export interface NativeGitErrorDetail {
  category: NativeGitErrorCategory;
  message: string;
}

export interface NativeGitRepositoryInfo {
  gitDir: string;
  workDir?: string;
  bare: boolean;
}

interface NativeGitRepositoryInfoResult {
  repository?: NativeGitRepositoryInfo;
  error?: NativeGitErrorDetail;
}

export interface NativeGitSnapshotOptions {
  includeIgnored?: boolean;
  recentCommitLimit?: number;
  statusLimit?: number;
  refLimit?: number;
  stashLimit?: number;
}

export interface NativeGitReference {
  name: string;
  target?: string;
  symbolicTarget?: string;
  upstream?: string;
}

export interface NativeGitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface NativeGitFileStatus {
  path: string;
  renamedFrom?: string;
  index: string;
  worktree: string;
  untracked: boolean;
  ignored: boolean;
}

export interface NativeGitRecentCommit {
  oid: string;
  subject: string;
  timestampSeconds: number;
}

export interface NativeGitStash {
  index: number;
  oid: string;
  message: string;
  timestampSeconds: number;
}

export interface NativeGitSnapshot {
  gitDir: string;
  workDir?: string;
  headOid?: string;
  headBranch?: string;
  detached: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  refs: NativeGitReference[];
  remotes: NativeGitRemote[];
  files: NativeGitFileStatus[];
  recentCommits: NativeGitRecentCommit[];
  stashes: NativeGitStash[];
}

interface NativeGitSnapshotResult {
  snapshot?: NativeGitSnapshot;
  error?: NativeGitErrorDetail;
}

export interface NativeGitAncestry {
  ancestorOid: string;
  descendantOid: string;
  isAncestor: boolean;
}

interface NativeGitAncestryResult {
  ancestry?: NativeGitAncestry;
  error?: NativeGitErrorDetail;
}

export type NativeGitDocumentSource = {
  kind: "revision" | "index" | "worktree" | "empty";
  path: string;
  revision?: string;
};

export type NativeGitFileDocument = {
  content?: string;
  binary: boolean;
  size: number;
};

export type NativeGitFileDiff = {
  original: NativeGitFileDocument;
  modified: NativeGitFileDocument;
};

interface NativeGitFileDiffResult {
  diff?: NativeGitFileDiff;
  error?: NativeGitErrorDetail;
}

interface NativeGitRevisionResult {
  oid?: string;
  error?: NativeGitErrorDetail;
}

export class NativeGitReadError extends Error {
  constructor(
    readonly category: NativeGitErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "NativeGitReadError";
  }
}

export async function readGitRepositoryInfo(
  path: string,
): Promise<NativeGitRepositoryInfo> {
  const result = await binding.readGitRepositoryInfo(path);
  if (result.error) throw nativeGitError(result.error);
  if (!result.repository)
    throw new NativeGitReadError(
      "internal",
      "Native Git repository info was empty.",
    );
  return result.repository;
}

export async function readGitSnapshot(
  path: string,
  options?: NativeGitSnapshotOptions,
): Promise<NativeGitSnapshot> {
  const result = await binding.readGitSnapshot(path, options);
  if (result.error) throw nativeGitError(result.error);
  if (!result.snapshot)
    throw new NativeGitReadError("internal", "Native Git snapshot was empty.");
  return result.snapshot;
}

export async function checkGitAncestry(
  path: string,
  ancestor: string,
  descendant: string,
): Promise<NativeGitAncestry> {
  const result = await binding.checkGitAncestry(path, ancestor, descendant);
  if (result.error) throw nativeGitError(result.error);
  if (!result.ancestry)
    throw new NativeGitReadError("internal", "Native Git ancestry was empty.");
  return result.ancestry;
}

export async function resolveGitRevision(
  path: string,
  revision: string,
): Promise<string> {
  const result = await binding.resolveGitRevision(path, revision);
  if (result.error) throw nativeGitError(result.error);
  if (!result.oid)
    throw new NativeGitReadError("internal", "Native Git revision was empty.");
  return result.oid;
}

export async function readGitFileDiff(
  path: string,
  original: NativeGitDocumentSource,
  modified: NativeGitDocumentSource,
): Promise<NativeGitFileDiff> {
  const result = await binding.readGitFileDiff(path, original, modified);
  if (result.error) throw nativeGitError(result.error);
  if (!result.diff)
    throw new NativeGitReadError("internal", "Native Git file diff was empty.");
  return result.diff;
}

export function validateGitBranchName(name: string): boolean {
  return binding.validateGitBranchName(name);
}

function nativeGitError(detail: NativeGitErrorDetail): NativeGitReadError {
  return new NativeGitReadError(detail.category, detail.message);
}

export function nativeRuntimeCapabilities(): {
  platform: string;
  capabilities: string[];
} {
  return binding.runtimeCapabilities();
}

export function inspectManagedTarget(target: ManagedTarget): InspectionResult {
  try {
    return binding.inspectManagedTarget(target);
  } catch (error) {
    return { evidence: "unknown", detail: errorMessage(error) };
  }
}

export async function terminateManagedTarget(
  target: ManagedTarget,
  signal: NodeJS.Signals = "SIGKILL",
): Promise<TerminationResult> {
  try {
    return binding.terminateManagedTarget(target, signal);
  } catch (error) {
    return {
      attempted: false,
      terminated: false,
      method: "none",
      error: errorMessage(error),
    };
  }
}

export function spawnManagedProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ManagedProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exited = deferred<ManagedProcessExit>();
  const closed = deferred<ManagedProcessExit>();
  let exitSettled = false;
  let closeSettled = false;

  const settleExit = (result: ManagedProcessExit) => {
    if (exitSettled) return;
    exitSettled = true;
    exited.resolve(result);
  };
  const settleClose = (result: ManagedProcessExit) => {
    if (closeSettled) return;
    closeSettled = true;
    stdout.end();
    stderr.end();
    settleExit(result);
    closed.resolve(result);
  };

  let handle: NativeProcessHandle;
  try {
    handle = binding.spawnManagedProcess(
      command,
      args,
      { cwd: options.cwd, env: stringEnvironment(options.env) },
      (error, chunk) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        else stdout.write(chunk);
      },
      (error, chunk) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        else stderr.write(chunk);
      },
      (error, result) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        settleExit(exitResult(result));
      },
      (error, result) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        settleClose(exitResult(result));
      },
    );
  } catch (error) {
    stdout.destroy();
    stderr.destroy();
    throw error;
  }

  const target = normalizeTarget(handle.target, handle);
  return {
    pid: handle.pid,
    identity: handle.identity,
    containment: handle.containment,
    target,
    stdout,
    stderr,
    exited: exited.promise,
    closed: closed.promise,
    async terminate(signal = "SIGKILL") {
      try {
        return handle.terminate(signal);
      } catch (error) {
        return {
          attempted: false,
          terminated: false,
          method: "none",
          error: errorMessage(error),
        };
      }
    },
  };
}

export function spawnManagedChildProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ChildProcess {
  const managed = spawnManagedProcess(command, args, options);
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    pid: { value: managed.pid, enumerable: true },
    stdout: { value: managed.stdout, enumerable: true },
    stderr: { value: managed.stderr, enumerable: true },
    stdin: { value: null, enumerable: true },
    exitCode: { value: null, writable: true, enumerable: true },
    signalCode: { value: null, writable: true, enumerable: true },
    killed: { value: false, writable: true, enumerable: true },
  });
  child.kill = (signal = "SIGTERM") => {
    Reflect.set(child, "killed", true);
    void managed.terminate(typeof signal === "string" ? signal : "SIGTERM");
    return true;
  };
  void managed.exited.then(({ exitCode, signal }) => {
    Reflect.set(child, "exitCode", exitCode);
    Reflect.set(child, "signalCode", signal);
    child.emit("exit", exitCode, signal);
  });
  void managed.closed.then(({ exitCode, signal }) =>
    child.emit("close", exitCode, signal),
  );
  childProcesses.set(child, managed);
  return child;
}

export function managedProcessForChild(
  child: ChildProcess,
): ManagedProcess | undefined {
  return childProcesses.get(child);
}

export async function terminateManagedChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGKILL",
): Promise<TerminationResult | undefined> {
  return childProcesses.get(child)?.terminate(signal);
}

function loadBinding(): NativeBinding {
  const require = createRequire(import.meta.url);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const binaryName = `nerve_native.${platformTriple()}.node`;
  const candidates = [
    join(moduleDir, "..", "prebuilds", binaryName),
    join(moduleDir, "..", "prebuilds", "local", binaryName),
    join(moduleDir, "..", "..", "prebuilds", binaryName),
    join(moduleDir, "..", "..", "prebuilds", "local", binaryName),
  ];
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return require(candidate) as NativeBinding;
    } catch (error) {
      errors.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  const detail =
    errors.join("; ") ||
    `No native prebuild for ${process.platform}/${process.arch}`;
  throw new Error(`Native runtime failed to load: ${detail}`);
}

function normalizeTarget(
  target: ManagedTarget | undefined,
  handle: NativeProcessHandle,
): ManagedTarget {
  return (
    target ?? {
      pid: handle.pid,
      processGroupId: handle.processGroupId,
      containment: handle.containment,
      identity: handle.identity,
    }
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function exitResult([code, signal]: [number, string]): ManagedProcessExit {
  return {
    exitCode: code < 0 ? null : code,
    signal: signalName(signal),
  };
}

function platformTriple(): string {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "linux") return `linux-${process.arch}-gnu`;
  return `${process.platform}-${process.arch}`;
}

function stringEnvironment(env: NodeJS.ProcessEnv | undefined) {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function signalName(value: string): NodeJS.Signals | null {
  if (!value) return null;
  if (value.startsWith("SIG")) return value as NodeJS.Signals;
  const number = Number(value);
  if (number === 9) return "SIGKILL";
  if (number === 15) return "SIGTERM";
  if (number === 2) return "SIGINT";
  if (number === 1) return "SIGHUP";
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
