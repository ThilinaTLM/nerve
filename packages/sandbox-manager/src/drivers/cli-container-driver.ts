import { type ExecFileOptions, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
  LogReadOptions,
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RemoveOptions,
  RuntimeDriverCapabilities,
  StopOptions,
} from "@nervekit/contracts";
import { containerCreateArgs, containerName } from "./container-args.js";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "./container-runtime-driver.js";
import { assertValidManagedContainerCreateSpec } from "./validation.js";

const execFileAsync = promisify(execFile);
type CliDriverKind = "docker" | "podman" | "podman-wsl";
type CliCommand = string | string[];

export class CliContainerDriver implements ContainerRuntimeDriver {
  constructor(
    readonly kind: CliDriverKind,
    private readonly command: CliCommand = kind,
  ) {}
  async capabilities(): Promise<RuntimeDriverCapabilities> {
    try {
      const { stdout } = await this.exec(
        [
          "version",
          "--format",
          this.kind === "docker" ? "{{.Server.Version}}" : "{{.Version}}",
        ],
        { timeout: 2_000 },
      );
      return {
        kind: this.kind,
        available: true,
        version: stdout.trim() || undefined,
        rootless:
          this.kind === "podman" || this.kind === "podman-wsl"
            ? true
            : undefined,
        supportsReadOnlyRootFilesystem: true,
        supportsNoNewPrivileges: true,
        supportsPidsLimit: true,
        supportsCpuLimit: true,
        supportsMemoryLimit: true,
        supportsTmpfs: true,
        supportsLogs: true,
        resourceOptions: {
          memoryMb: { min: 128, step: 128, default: 4096 },
          vcpu: { min: 0.25, step: 0.25 },
        },
        limitations: [],
      };
    } catch {
      return {
        kind: this.kind,
        available: false,
        supportsReadOnlyRootFilesystem: false,
        supportsNoNewPrivileges: false,
        supportsPidsLimit: false,
        supportsCpuLimit: false,
        supportsMemoryLimit: false,
        supportsTmpfs: false,
        supportsLogs: false,
        limitations: [`${this.commandDescription()} CLI is not available`],
      };
    }
  }
  async create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef> {
    assertValidManagedContainerCreateSpec(spec, { production: true });
    const { stdout } = await this.exec(containerCreateArgs(spec), {
      timeout: 30_000,
    });
    return { kind: this.kind, id: stdout.trim(), name: containerName(spec) };
  }
  async start(ref: ManagedContainerRef): Promise<void> {
    await this.exec(["start", ref.id], { timeout: 30_000 });
  }
  async inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus> {
    try {
      const { stdout } = await this.exec(
        ["inspect", ref.id, "--format", "{{json .}}"],
        { timeout: 10_000 },
      );
      const data = JSON.parse(stdout) as {
        State?: {
          Status?: string;
          ExitCode?: number;
          StartedAt?: string;
          FinishedAt?: string;
          Health?: { Status?: string };
        };
      };
      const status = data.State?.Status;
      return {
        ref,
        state: mapState(status),
        exitCode: data.State?.ExitCode,
        startedAt: normalizeDate(data.State?.StartedAt),
        finishedAt: normalizeDate(data.State?.FinishedAt),
        health: mapHealth(data.State?.Health?.Status),
      };
    } catch (error) {
      return {
        ref,
        state: "unknown",
        limitations: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
  logs(
    ref: ManagedContainerRef,
    options: LogReadOptions = {},
  ): AsyncIterable<LogChunk> {
    const [bin, ...prefix] = this.commandParts();
    return {
      async *[Symbol.asyncIterator]() {
        const args = [
          "logs",
          ...(options.tail !== undefined
            ? ["--tail", String(options.tail)]
            : []),
          ...(options.since ? ["--since", options.since] : []),
          ref.id,
        ];
        const child = spawn(bin, [...prefix, ...args], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        for await (const chunk of child.stdout)
          yield { stream: "stdout", chunk: String(chunk) };
        for await (const chunk of child.stderr)
          yield { stream: "stderr", chunk: String(chunk) };
      },
    };
  }
  async stop(
    ref: ManagedContainerRef,
    options: StopOptions = {},
  ): Promise<void> {
    await this.exec(
      [
        "stop",
        ...(options.timeoutMs !== undefined
          ? ["--time", String(Math.ceil(options.timeoutMs / 1000))]
          : []),
        ref.id,
      ],
      { timeout: (options.timeoutMs ?? 10_000) + 5_000 },
    );
  }
  async kill(ref: ManagedContainerRef, signal = "SIGKILL"): Promise<void> {
    await this.exec(["kill", "--signal", signal, ref.id], {
      timeout: 10_000,
    });
  }
  async remove(
    ref: ManagedContainerRef,
    options: RemoveOptions = {},
  ): Promise<void> {
    try {
      await this.exec(
        [
          "rm",
          ...(options.force ? ["--force"] : []),
          ...(options.removeVolumes ? ["--volumes"] : []),
          ref.id,
        ],
        { timeout: 30_000 },
      );
    } catch (error) {
      // Removal is idempotent: reconciliation or an operator may have already
      // deleted a stale container while its persisted ref still exists.
      if (!isMissingContainerError(error)) throw error;
    }
  }

  private commandParts(): string[] {
    return Array.isArray(this.command) ? this.command : [this.command];
  }

  private commandDescription(): string {
    return this.commandParts().join(" ");
  }

  private exec(
    args: string[],
    options: ExecFileOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    const [file, ...prefix] = this.commandParts();
    return execFileAsync(file, [...prefix, ...args], options) as Promise<{
      stdout: string;
      stderr: string;
    }>;
  }
}
function isMissingContainerError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .replaceAll("\n", " ");
  return (
    message.includes("no such container") ||
    (message.includes("no container with name or id") &&
      message.includes("found"))
  );
}
function mapState(status: string | undefined): ManagedContainerStatus["state"] {
  if (status === "running") return "running";
  if (status === "created") return "creating";
  if (status === "exited" || status === "dead") return "exited";
  if (status === "removing") return "removed";
  return "unknown";
}
function mapHealth(
  status: string | undefined,
): ManagedContainerStatus["health"] {
  return status === "healthy" || status === "unhealthy" || status === "starting"
    ? status
    : "unknown";
}
function normalizeDate(value: string | undefined): string | undefined {
  if (!value || value.startsWith("0001-")) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
