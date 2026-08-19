import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_WORKER_MAX_FRAME_BYTES,
  EXECUTION_WORKER_PROTOCOL_VERSION,
  workerExecutionSnapshotSchema,
  workerHealthSchema,
  workerMetadataSchema,
  workerPushFrameSchema,
  workerReadResultSchema,
  workerResponseSchema,
  workerTerminationResultSchema,
  type WorkerExecutionSnapshot,
  type WorkerHealth,
  type WorkerMetadata,
  type WorkerReadResult,
  type WorkerStartExecution,
  type WorkerTerminationResult,
} from "@nervekit/contracts";

const STARTUP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
// Long read timeout for streaming subscriptions; the worker heartbeats every
// 2s while a run is active, so an idle-but-running stream stays alive.
const STREAM_FRAME_TIMEOUT_MS = 30_000;

export interface ExecutionOutputSubscription {
  close(): void;
  readonly settled: Promise<WorkerExecutionSnapshot>;
}

export class ExecutionWorkerClient {
  constructor(
    readonly home: string,
    private metadata: WorkerMetadata,
    private token: string,
  ) {
    this.recovering = null;
  }

  private recovering: Promise<boolean> | null;

  static async connect(home: string): Promise<ExecutionWorkerClient> {
    await ensureCompatibleWorker(home);
    const existing = await connectExisting(home);
    if (existing) return existing;
    launchWorker(home);
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      await delay(50);
      try {
        const client = await connectExisting(home);
        if (client) return client;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `Execution worker did not become ready within ${STARTUP_TIMEOUT_MS}ms${lastError ? `: ${errorMessage(lastError)}` : ""}`,
    );
  }

  async health(): Promise<WorkerHealth> {
    return workerHealthSchema.parse(await this.request("worker.health", {}));
  }

  async start(input: WorkerStartExecution): Promise<WorkerExecutionSnapshot> {
    return workerExecutionSnapshotSchema.parse(
      await this.request("execution.start", input),
    );
  }

  async get(executionId: string): Promise<WorkerExecutionSnapshot | undefined> {
    const value = await this.request("execution.get", { executionId });
    return value === null || value === undefined
      ? undefined
      : workerExecutionSnapshotSchema.parse(value);
  }

  async list(): Promise<WorkerExecutionSnapshot[]> {
    const value = await this.request("execution.list", {});
    return workerExecutionSnapshotSchema.array().parse(value);
  }

  async read(executionId: string, afterCursor = 0): Promise<WorkerReadResult> {
    return workerReadResultSchema.parse(
      await this.request("execution.read", { executionId, afterCursor }),
    );
  }

  async cancel(
    executionId: string,
    signal: NodeJS.Signals = "SIGTERM",
  ): Promise<WorkerTerminationResult> {
    return workerTerminationResultSchema.parse(
      await this.request("execution.cancel", { executionId, signal }),
    );
  }

  async remove(executionId: string): Promise<void> {
    await this.request("execution.remove", { executionId });
  }

  async spawnChild(
    input: WorkerStartExecution,
  ): Promise<{ child: ChildProcess; snapshot: WorkerExecutionSnapshot }> {
    const snapshot = await this.start(input);
    if (!snapshot.target)
      throw new Error("Worker execution has no process target.");
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperties(child, {
      pid: { value: snapshot.target.pid, enumerable: true },
      stdout: { value: stdout, enumerable: true },
      stderr: { value: stderr, enumerable: true },
      stdin: { value: null, enumerable: true },
      exitCode: { value: null, writable: true, enumerable: true },
      signalCode: { value: null, writable: true, enumerable: true },
      killed: { value: false, writable: true, enumerable: true },
    });
    child.kill = (signal = "SIGTERM") => {
      Reflect.set(child, "killed", true);
      void this.cancel(
        input.executionId,
        typeof signal === "string" ? signal : "SIGTERM",
      );
      return true;
    };
    void this.subscribe(input.executionId, {
      onOutput: (stream, chunk) => {
        (stream === "stdout" ? stdout : stderr).write(chunk);
      },
    }).settled.then(
      (terminal) => {
        stdout.end();
        stderr.end();
        const exitCode = terminal.exitCode ?? null;
        const signal = (terminal.signal as NodeJS.Signals | undefined) ?? null;
        Reflect.set(child, "exitCode", exitCode);
        Reflect.set(child, "signalCode", signal);
        child.emit("exit", exitCode, signal);
        child.emit("close", exitCode, signal);
      },
      (error: unknown) => {
        stdout.destroy();
        stderr.destroy();
        child.emit(
          "error",
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
    return { child, snapshot };
  }

  subscribe(
    executionId: string,
    options: {
      afterCursor?: number;
      signal?: AbortSignal;
      onOutput?: (
        stream: "stdout" | "stderr",
        chunk: Buffer,
        cursor: number,
      ) => void | Promise<void>;
      onSnapshot?: (snapshot: WorkerExecutionSnapshot) => void | Promise<void>;
      onCursor?: (cursor: number) => void | Promise<void>;
    } = {},
  ): ExecutionOutputSubscription {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const afterCursor = options.afterCursor ?? 0;
    const run =
      this.metadata.protocolVersion >= 2
        ? this.subscribeStream(
            executionId,
            afterCursor,
            controller.signal,
            options.onOutput,
            options.onSnapshot,
            options.onCursor,
          )
        : this.pollExecution(
            executionId,
            afterCursor,
            controller.signal,
            options.onOutput,
            options.onSnapshot,
            options.onCursor,
          );
    const settled = run.finally(() =>
      options.signal?.removeEventListener("abort", onAbort),
    );
    return { close: () => controller.abort(), settled };
  }

  /** v2: worker pushes output/snapshot/terminal frames until done. */
  private async subscribeStream(
    executionId: string,
    initialCursor: number,
    signal: AbortSignal,
    onOutput?: (
      stream: "stdout" | "stderr",
      chunk: Buffer,
      cursor: number,
    ) => void | Promise<void>,
    onSnapshot?: (snapshot: WorkerExecutionSnapshot) => void | Promise<void>,
    onCursor?: (cursor: number) => void | Promise<void>,
  ): Promise<WorkerExecutionSnapshot> {
    const id = randomUUID();
    const socket = await openSocket(this.metadata, REQUEST_TIMEOUT_MS);
    const onAbort = () => socket.destroy();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      socket.write(
        encodeFrame({
          version: EXECUTION_WORKER_PROTOCOL_VERSION,
          token: this.token,
          id,
          method: "execution.subscribe",
          params: { executionId, afterCursor: initialCursor },
        }),
      );
      let cursor = initialCursor;
      for (;;) {
        const frame = await readFrame(socket, STREAM_FRAME_TIMEOUT_MS);
        if (signal.aborted) throw new Error("Execution subscription aborted.");
        const response = workerResponseSchema.parse(
          JSON.parse(frame.toString("utf8")),
        );
        if (!response.ok) {
          throw new Error(
            `${response.error?.code ?? "WORKER_ERROR"}: ${response.error?.message ?? "Execution worker request failed"}`,
          );
        }
        const push = workerPushFrameSchema.parse(response.result);
        if (push.kind === "ack") {
          if (push.snapshot) await onSnapshot?.(push.snapshot);
        } else if (push.kind === "snapshot") {
          if (push.snapshot) await onSnapshot?.(push.snapshot);
        } else if (push.kind === "output") {
          for (const event of push.events ?? []) {
            if (event.kind === "output" && event.stream && event.dataBase64) {
              await onOutput?.(
                event.stream,
                Buffer.from(event.dataBase64, "base64"),
                event.cursor,
              );
            }
            cursor = Math.max(cursor, event.cursor);
          }
          if (push.cursor !== undefined) cursor = Math.max(cursor, push.cursor);
          await onCursor?.(cursor);
        } else if (push.kind === "terminal") {
          if (push.snapshot) {
            await onSnapshot?.(push.snapshot);
            return push.snapshot;
          }
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      socket.destroy();
    }
  }

  private async pollExecution(
    executionId: string,
    initialCursor: number,
    signal: AbortSignal,
    onOutput?: (
      stream: "stdout" | "stderr",
      chunk: Buffer,
      cursor: number,
    ) => void | Promise<void>,
    onSnapshot?: (snapshot: WorkerExecutionSnapshot) => void | Promise<void>,
    onCursor?: (cursor: number) => void | Promise<void>,
  ): Promise<WorkerExecutionSnapshot> {
    let cursor = initialCursor;
    while (!signal.aborted) {
      const result = await this.read(executionId, cursor);
      const previousCursor = cursor;
      for (const event of result.events) {
        if (event.kind === "output" && event.stream && event.dataBase64) {
          await onOutput?.(
            event.stream,
            Buffer.from(event.dataBase64, "base64"),
            event.cursor,
          );
        }
        cursor = Math.max(cursor, event.cursor);
      }
      await onSnapshot?.(result.snapshot);
      if (cursor > previousCursor) await onCursor?.(cursor);
      if (
        !["starting", "running"].includes(result.snapshot.status) &&
        cursor >= result.snapshot.cursor
      ) {
        return result.snapshot;
      }
      await abortableDelay(result.events.length > 0 ? 0 : 25, signal);
    }
    throw new Error("Execution subscription aborted.");
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    try {
      return await this.exchangeFrame(method, params);
    } catch (error) {
      if (!isRetryableConnectionError(error)) throw error;
      // A connection-level failure usually means the worker was replaced or
      // restarted. Re-resolve worker.json / respawn once, then retry so a
      // long-lived client is never permanently pinned to a dead port.
      const recovered = await (this.recovering ??= this.recover().finally(
        () => {
          this.recovering = null;
        },
      ));
      if (!recovered) throw error;
      return await this.exchangeFrame(method, params);
    }
  }

  private async exchangeFrame(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const id = randomUUID();
    const response = await exchange(
      this.metadata,
      {
        version: EXECUTION_WORKER_PROTOCOL_VERSION,
        token: this.token,
        id,
        method,
        params,
      },
      REQUEST_TIMEOUT_MS,
    );
    if (response.id !== id) {
      throw new Error("Execution worker response correlation mismatch.");
    }
    if (!response.ok) {
      throw new Error(
        `${response.error?.code ?? "WORKER_ERROR"}: ${response.error?.message ?? "Execution worker request failed"}`,
      );
    }
    return response.result;
  }

  private async recover(): Promise<boolean> {
    const fresh = await readWorkerEndpoint(this.home);
    if (fresh && !sameEndpoint(this.metadata, fresh.metadata)) {
      if (await isEndpointHealthy(fresh)) {
        this.rebind(fresh.metadata, fresh.token);
        return true;
      }
    }
    const spawned = await spawnWorkerEndpoint(this.home);
    if (!spawned) return false;
    this.rebind(spawned.metadata, spawned.token);
    return true;
  }

  private rebind(metadata: WorkerMetadata, token: string): void {
    this.metadata = metadata;
    this.token = token;
  }
}

async function connectExisting(
  home: string,
): Promise<ExecutionWorkerClient | undefined> {
  const [metadataRaw, tokenRaw] = await Promise.all([
    readFile(join(home, "execution-runtime", "worker.json"), "utf8").catch(
      () => undefined,
    ),
    readFile(join(home, "auth", "execution-worker-token"), "utf8").catch(
      () => undefined,
    ),
  ]);
  if (!metadataRaw || !tokenRaw?.trim()) return undefined;
  const metadata = workerMetadataSchema.parse(JSON.parse(metadataRaw));
  const client = new ExecutionWorkerClient(home, metadata, tokenRaw.trim());
  await client.health();
  return client;
}

export interface WorkerEndpoint {
  home: string;
  metadata: WorkerMetadata;
  token: string;
}

interface WorkerErrorLike {
  code?: string;
  message?: string;
  errno?: number | string;
  syscall?: string;
}

/** Connection-level failures that mean the worker has gone away or moved. */
export function isRetryableConnectionError(error: unknown): boolean {
  const code =
    (error as WorkerErrorLike | null)?.errno ??
    (error as NodeJS.ErrnoException).code;
  const name = (error as Error | null)?.name;
  const message = (error as Error | null)?.message ?? "";
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ETIMEDOUT" ||
    name === "ConnectionError" ||
    /(socket hang up|closed abruptly|connection timed out)/i.test(message)
  ) {
    return true;
  }
  return false;
}

async function readWorkerEndpoint(
  home: string,
): Promise<WorkerEndpoint | undefined> {
  const [metadataRaw, tokenRaw] = await Promise.all([
    readFile(join(home, "execution-runtime", "worker.json"), "utf8").catch(
      () => undefined,
    ),
    readFile(join(home, "auth", "execution-worker-token"), "utf8").catch(
      () => undefined,
    ),
  ]);
  if (!metadataRaw || !tokenRaw?.trim()) return undefined;
  try {
    return {
      home,
      metadata: workerMetadataSchema.parse(JSON.parse(metadataRaw)),
      token: tokenRaw.trim(),
    };
  } catch {
    return undefined;
  }
}

function sameEndpoint(a: WorkerMetadata, b: WorkerMetadata): boolean {
  return a.host === b.host && a.port === b.port && a.pid === b.pid;
}

async function isEndpointHealthy(endpoint: WorkerEndpoint): Promise<boolean> {
  const probe = new ExecutionWorkerClient(
    endpoint.home,
    endpoint.metadata,
    endpoint.token,
  );
  try {
    await probe.health();
    return true;
  } catch {
    return false;
  }
}

/** Spawn a replacement worker (if needed) and return its fresh endpoint. */
async function spawnWorkerEndpoint(
  home: string,
): Promise<WorkerEndpoint | undefined> {
  await ensureCompatibleWorker(home);
  launchWorker(home);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(50);
    try {
      if (await connectExisting(home)) {
        return await readWorkerEndpoint(home);
      }
    } catch {
      // keep waiting for the replacement
    }
  }
  return undefined;
}

/**
 * If the worker registered in `worker.json` was built with an older protocol
 * than this client (e.g. a leftover process from before an upgrade), it cannot
 * be served by us and still holds the profile lock. Terminate it and remove its
 * stale registration so the current binary can take over the profile.
 */
async function ensureCompatibleWorker(home: string): Promise<void> {
  const endpoint = await readWorkerEndpoint(home);
  if (!endpoint) return;
  if (endpoint.metadata.protocolVersion >= EXECUTION_WORKER_PROTOCOL_VERSION) {
    return;
  }
  await terminateProcess(endpoint.metadata.pid);
  await delay(100);
  await unlink(join(home, "execution-runtime", "worker.json")).catch(
    () => undefined,
  );
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // not ours / already gone
  }
  await delay(150);
  try {
    process.kill(pid, 0);
  } catch {
    return; // terminated by SIGTERM
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}

function launchWorker(home: string): void {
  const child = spawn(resolveExecutionWorkerPath(), ["--home", home], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

export function resolveExecutionWorkerPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const name = executionWorkerFilename();
  const candidates = [
    join(moduleDir, "..", "prebuilds", name),
    join(moduleDir, "..", "prebuilds", "local", name),
    join(moduleDir, "..", "..", "prebuilds", name),
    join(moduleDir, "..", "..", "prebuilds", "local", name),
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (!existing) {
    throw new Error(
      `Execution worker binary ${name} was not found. Run pnpm build:native.`,
    );
  }
  return existing;
}

export function executionWorkerFilename(): string {
  const architecture = process.arch === "x64" ? "x64" : "arm64";
  const platform =
    process.platform === "linux"
      ? `linux-${architecture}-gnu`
      : process.platform === "win32"
        ? `win32-${architecture}-msvc`
        : process.platform === "darwin"
          ? `darwin-${architecture}`
          : undefined;
  if (!platform) {
    throw new Error(
      `Unsupported execution worker platform ${process.platform}/${process.arch}`,
    );
  }
  return `nerve_execution_worker.${platform}${process.platform === "win32" ? ".exe" : ""}`;
}

async function exchange(
  metadata: WorkerMetadata,
  request: unknown,
  timeoutMs: number,
): Promise<ReturnType<typeof workerResponseSchema.parse>> {
  const frame = encodeFrame(request);
  const socket = await openSocket(metadata, timeoutMs);
  try {
    socket.write(frame);
    const response = await readFrame(socket, timeoutMs);
    return workerResponseSchema.parse(JSON.parse(response.toString("utf8")));
  } finally {
    socket.destroy();
  }
}

function encodeFrame(request: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(request));
  if (payload.length > EXECUTION_WORKER_MAX_FRAME_BYTES) {
    throw new Error("Execution worker request exceeds the frame limit.");
  }
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function openSocket(
  metadata: WorkerMetadata,
  timeoutMs: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: metadata.host, port: metadata.port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Execution worker connection timed out."));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function readFrame(socket: Socket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let expected: number | undefined;
    const timeout = setTimeout(
      () => finish(new Error("Execution worker response timed out.")),
      timeoutMs,
    );
    const finish = (error?: Error, value?: Buffer) => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(value ?? Buffer.alloc(0));
    };
    const onError = (error: Error) => finish(error);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (expected === undefined && buffered.length >= 4) {
        expected = buffered.readUInt32BE(0);
        buffered = buffered.subarray(4);
        if (expected <= 0 || expected > EXECUTION_WORKER_MAX_FRAME_BYTES) {
          finish(
            new Error("Execution worker returned an invalid frame length."),
          );
          return;
        }
      }
      if (expected !== undefined && buffered.length >= expected) {
        finish(undefined, buffered.subarray(0, expected));
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new Error("Execution subscription aborted."));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("Execution subscription aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
