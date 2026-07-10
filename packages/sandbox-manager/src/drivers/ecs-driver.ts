import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  DeregisterTaskDefinitionCommand,
  DescribeClustersCommand,
  DescribeTasksCommand,
  ECSClient,
  type HealthCheck,
  ListTasksCommand,
  type LogConfiguration,
  RegisterTaskDefinitionCommand,
  type RegisterTaskDefinitionCommandInput,
  RunTaskCommand,
  type RunTaskCommandInput,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import type {
  LogReadOptions,
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RemoveOptions,
  RuntimeDriverCapabilities,
  RuntimeResourceSpec,
  StopOptions,
  VolumeRef,
} from "@nervekit/contracts";
import type { ManagerConfig } from "../config/manager-config.js";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "./container-runtime-driver.js";
import { assertValidManagedContainerCreateSpec } from "./validation.js";

const STARTED_BY = "nerve-sandbox-manager";
const SPEC_LABEL = "org.nerve.sandbox.spec";
const SANDBOX_ID_LABEL = "org.nerve.sandbox.id";
const INSTANCE_LABEL = "org.nerve.sandbox.instance";

type SendableCommand = { input: unknown; constructor: { name: string } };
export type AwsClientLike = {
  send(command: SendableCommand): Promise<unknown>;
};

export type EcsContainerDriverClients = {
  ecs?: AwsClientLike;
  logs?: AwsClientLike;
};

type EcsTask = {
  taskArn?: string;
  taskDefinitionArn?: string;
  clusterArn?: string;
  lastStatus?: string;
  desiredStatus?: string;
  startedAt?: Date | string;
  stoppedAt?: Date | string;
  stoppedReason?: string;
  containers?: EcsTaskContainer[];
  tags?: EcsTag[];
};

type EcsTaskContainer = {
  name?: string;
  lastStatus?: string;
  exitCode?: number;
  healthStatus?: string;
};

type EcsTag = { key?: string; value?: string };

type DescribeClustersResponse = {
  clusters?: Array<{ clusterArn?: string; status?: string }>;
};

type RegisterTaskDefinitionResponse = {
  taskDefinition?: { taskDefinitionArn?: string };
};

type RunTaskResponse = {
  tasks?: EcsTask[];
  failures?: Array<{ arn?: string; reason?: string; detail?: string }>;
};

type DescribeTasksResponse = {
  tasks?: EcsTask[];
  failures?: Array<{ arn?: string; reason?: string; detail?: string }>;
};

type ListTasksResponse = { taskArns?: string[] };

type GetLogEventsResponse = {
  events?: Array<{ timestamp?: number; message?: string }>;
  nextForwardToken?: string;
};

export class EcsContainerDriver implements ContainerRuntimeDriver {
  readonly kind = "ecs";
  private readonly ecs: AwsClientLike;
  private readonly logsClient: AwsClientLike;

  constructor(
    private readonly config: ManagerConfig,
    clients: EcsContainerDriverClients = {},
  ) {
    this.ecs =
      clients.ecs ?? awsClient(new ECSClient({ region: config.awsRegion }));
    this.logsClient =
      clients.logs ??
      awsClient(new CloudWatchLogsClient({ region: config.awsRegion }));
  }

  async capabilities(): Promise<RuntimeDriverCapabilities> {
    const limitations = ecsLimitations();
    try {
      const response = await this.sendEcs<DescribeClustersResponse>(
        new DescribeClustersCommand({ clusters: [this.clusterArn()] }),
      );
      const cluster = response.clusters?.[0];
      const available = !!cluster && cluster.status !== "INACTIVE";
      return {
        kind: this.kind,
        available,
        version: cluster?.clusterArn,
        supportsReadOnlyRootFilesystem: true,
        supportsNoNewPrivileges: false,
        supportsPidsLimit: false,
        supportsCpuLimit: true,
        supportsMemoryLimit: true,
        supportsTmpfs: false,
        supportsLogs: !!this.config.ecsLogGroup,
        resourceOptions: fargateResourceOptions(),
        limitations: available
          ? limitations
          : [
              `ECS cluster is unavailable: ${this.clusterArn()}`,
              ...limitations,
            ],
      };
    } catch (error) {
      return {
        kind: this.kind,
        available: false,
        supportsReadOnlyRootFilesystem: true,
        supportsNoNewPrivileges: false,
        supportsPidsLimit: false,
        supportsCpuLimit: true,
        supportsMemoryLimit: true,
        supportsTmpfs: false,
        supportsLogs: !!this.config.ecsLogGroup,
        resourceOptions: fargateResourceOptions(),
        limitations: [errorMessage(error), ...limitations],
      };
    }
  }

  async create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef> {
    assertValidManagedContainerCreateSpec(spec, { production: true });
    assertEcsCompatibleSpec(spec);
    const tags = ecsTags(spec);
    const registerResponse = await this.sendEcs<RegisterTaskDefinitionResponse>(
      new RegisterTaskDefinitionCommand(this.taskDefinitionInput(spec, tags)),
    );
    const taskDefinitionArn =
      registerResponse.taskDefinition?.taskDefinitionArn ?? "";
    if (!taskDefinitionArn)
      throw new Error("ECS RegisterTaskDefinition did not return an ARN");

    const runResponse = await this.sendEcs<RunTaskResponse>(
      new RunTaskCommand(this.runTaskInput(taskDefinitionArn, tags)),
    );
    if (runResponse.failures?.length) {
      throw new Error(
        `ECS RunTask failed: ${runResponse.failures
          .map((failure) =>
            [failure.arn, failure.reason, failure.detail]
              .filter(Boolean)
              .join(" "),
          )
          .join("; ")}`,
      );
    }
    const taskArn = runResponse.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error("ECS RunTask did not return a task ARN");
    const logStream = this.config.ecsLogGroup
      ? this.logStreamForTask(taskArn)
      : undefined;
    return {
      kind: this.kind,
      id: taskArn,
      name: containerName(spec),
      metadata: compactMetadata({
        sandboxId: spec.sandboxId,
        instanceId: spec.instanceId,
        taskDefinitionArn,
        clusterArn: this.clusterArn(),
        logGroup: this.config.ecsLogGroup,
        logStream,
      }),
    };
  }

  async start(_ref: ManagedContainerRef): Promise<void> {
    // ECS has no Docker-style created-but-not-started task state. create()
    // registers the task definition and immediately calls RunTask.
  }

  async inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus> {
    try {
      const task = await this.describeTask(ref);
      if (!task) {
        return {
          ref,
          state: "removed",
          limitations: ["ECS task was not returned by DescribeTasks"],
        };
      }
      const container = preferredContainer(task, this.config.ecsContainerName);
      return {
        ref,
        state: mapEcsState(task.lastStatus ?? container?.lastStatus),
        exitCode: container?.exitCode,
        startedAt: normalizeDate(task.startedAt),
        finishedAt: normalizeDate(task.stoppedAt),
        health: mapEcsHealth(container?.healthStatus),
        limitations: task.stoppedReason ? [task.stoppedReason] : undefined,
      };
    } catch (error) {
      return {
        ref,
        state: "unknown",
        limitations: [errorMessage(error)],
      };
    }
  }

  logs(
    ref: ManagedContainerRef,
    options: LogReadOptions = {},
  ): AsyncIterable<LogChunk> {
    const driver = this;
    return {
      async *[Symbol.asyncIterator]() {
        const group = ref.metadata?.logGroup ?? driver.config.ecsLogGroup;
        const stream = ref.metadata?.logStream;
        if (!group || !stream) {
          yield {
            stream: "stderr",
            chunk:
              "ECS CloudWatch logs are unavailable because log group or log stream metadata is missing\n",
          };
          return;
        }
        let nextToken: string | undefined;
        let previousToken: string | undefined;
        let pages = 0;
        const paginate = !!options.since;
        do {
          const response = await driver.sendLogs<GetLogEventsResponse>(
            new GetLogEventsCommand({
              logGroupName: group,
              logStreamName: stream,
              startTime: options.since ? Date.parse(options.since) : undefined,
              startFromHead: paginate,
              limit: options.tail
                ? Math.min(Math.max(options.tail, 1), 10_000)
                : undefined,
              nextToken,
            }),
          );
          for (const event of response.events ?? []) {
            yield {
              stream: "stdout",
              chunk: `${event.message ?? ""}\n`,
              ts:
                event.timestamp === undefined
                  ? undefined
                  : new Date(event.timestamp).toISOString(),
            };
          }
          if (!paginate) break;
          previousToken = nextToken;
          nextToken = response.nextForwardToken;
          pages += 1;
        } while (nextToken && nextToken !== previousToken && pages < 5);
      },
    };
  }

  async stop(
    ref: ManagedContainerRef,
    _options: StopOptions = {},
  ): Promise<void> {
    await this.stopTask(ref, "Nerve sandbox manager stop requested");
  }

  async kill(ref: ManagedContainerRef, signal = "SIGKILL"): Promise<void> {
    await this.stopTask(
      ref,
      `Nerve sandbox manager kill requested; ECS/Fargate does not support arbitrary POSIX signal ${signal}`,
    );
  }

  async remove(
    ref: ManagedContainerRef,
    _options: RemoveOptions = {},
  ): Promise<void> {
    await this.stopTask(ref, "Nerve sandbox manager remove requested").catch(
      () => undefined,
    );
    const taskDefinitionArn = ref.metadata?.taskDefinitionArn;
    if (taskDefinitionArn) {
      await this.sendEcs(
        new DeregisterTaskDefinitionCommand({
          taskDefinition: taskDefinitionArn,
        }),
      );
    }
  }

  async listManaged(): Promise<ManagedContainerRef[]> {
    const listed = await this.sendEcs<ListTasksResponse>(
      new ListTasksCommand({
        cluster: this.clusterArn(),
        startedBy: STARTED_BY,
      }),
    );
    const taskArns = listed.taskArns ?? [];
    if (taskArns.length === 0) return [];
    const described = await this.sendEcs<DescribeTasksResponse>(
      new DescribeTasksCommand({
        cluster: this.clusterArn(),
        tasks: taskArns,
        include: ["TAGS"],
      }),
    );
    return (described.tasks ?? [])
      .filter((task) => tagMap(task.tags).get(SPEC_LABEL) === "v1")
      .flatMap((task) => {
        if (!task.taskArn) return [];
        return [this.refFromTask(task)];
      });
  }

  private taskDefinitionInput(
    spec: ManagedContainerCreateSpec,
    tags: EcsTag[],
  ): RegisterTaskDefinitionCommandInput {
    const taskCpu = ecsTaskCpu(spec.resources);
    const taskMemory = String(spec.resources?.memoryMb ?? 4096);
    assertValidFargateResources(Number(taskCpu), Number(taskMemory));
    const volumes = spec.mounts.map((mount, index) => ({
      name: ecsVolumeName(mount, index),
      efsVolumeConfiguration: {
        fileSystemId: this.efsFileSystemId(),
        rootDirectory: mount.name ?? "/",
        transitEncryption: this.config.efsTransitEncryption,
      },
    }));
    return {
      family: taskFamily(this.config.ecsTaskDefinitionFamilyPrefix, spec),
      taskRoleArn: this.config.ecsSandboxTaskRoleArn,
      executionRoleArn: this.config.ecsTaskExecutionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: [this.config.ecsLaunchType],
      cpu: taskCpu,
      memory: taskMemory,
      containerDefinitions: [
        {
          name: this.config.ecsContainerName,
          image: spec.image,
          essential: true,
          command: spec.command,
          environment: Object.entries(spec.env).map(([name, value]) => ({
            name,
            value,
          })),
          dockerLabels: spec.labels,
          mountPoints: spec.mounts.map((mount, index) => ({
            sourceVolume: ecsVolumeName(mount, index),
            containerPath: mount.target,
            readOnly: mount.readonly === true,
          })),
          workingDirectory: spec.workingDir,
          user: spec.user,
          readonlyRootFilesystem: spec.security?.readOnlyRootFilesystem,
          linuxParameters: linuxParameters(spec),
          cpu: Number(taskCpu),
          memory: Number(taskMemory),
          healthCheck: healthCheck(spec),
          logConfiguration: this.logConfiguration(),
        },
      ],
      volumes,
      tags,
    };
  }

  private runTaskInput(
    taskDefinitionArn: string,
    tags: EcsTag[],
  ): RunTaskCommandInput {
    const input: RunTaskCommandInput = {
      cluster: this.clusterArn(),
      taskDefinition: taskDefinitionArn,
      count: 1,
      platformVersion: this.config.ecsPlatformVersion,
      enableExecuteCommand: this.config.ecsEnableExecuteCommand,
      startedBy: STARTED_BY,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.config.ecsSubnets,
          securityGroups: this.config.ecsSecurityGroups,
          assignPublicIp: this.config.ecsAssignPublicIp,
        },
      },
      tags,
    };
    if (this.config.ecsCapacityProviderStrategy.length > 0) {
      input.capacityProviderStrategy = this.config.ecsCapacityProviderStrategy;
    } else {
      input.launchType = this.config.ecsLaunchType;
    }
    return input;
  }

  private logConfiguration(): LogConfiguration | undefined {
    if (!this.config.ecsLogGroup) return undefined;
    return {
      logDriver: "awslogs",
      options: {
        "awslogs-group": this.config.ecsLogGroup,
        "awslogs-region": this.config.awsRegion ?? "",
        "awslogs-stream-prefix": this.config.ecsLogStreamPrefix,
      },
    };
  }

  private async describeTask(
    ref: ManagedContainerRef,
  ): Promise<EcsTask | undefined> {
    const response = await this.sendEcs<DescribeTasksResponse>(
      new DescribeTasksCommand({
        cluster: ref.metadata?.clusterArn ?? this.clusterArn(),
        tasks: [ref.id],
        include: ["TAGS"],
      }),
    );
    return response.tasks?.[0];
  }

  private async stopTask(
    ref: ManagedContainerRef,
    reason: string,
  ): Promise<void> {
    await this.sendEcs(
      new StopTaskCommand({
        cluster: ref.metadata?.clusterArn ?? this.clusterArn(),
        task: ref.id,
        reason,
      }),
    );
  }

  private refFromTask(task: EcsTask): ManagedContainerRef {
    const tags = tagMap(task.tags);
    const taskArn = task.taskArn ?? "";
    return {
      kind: this.kind,
      id: taskArn,
      name: taskNameFromTags(tags, taskArn),
      metadata: compactMetadata({
        sandboxId: tags.get(SANDBOX_ID_LABEL),
        instanceId: tags.get(INSTANCE_LABEL),
        taskDefinitionArn: task.taskDefinitionArn,
        clusterArn: task.clusterArn ?? this.clusterArn(),
        logGroup: this.config.ecsLogGroup,
        logStream: this.config.ecsLogGroup
          ? this.logStreamForTask(taskArn)
          : undefined,
      }),
    };
  }

  private logStreamForTask(taskArn: string): string {
    return `${this.config.ecsLogStreamPrefix}/${this.config.ecsContainerName}/${lastArnSegment(
      taskArn,
    )}`;
  }

  private clusterArn(): string {
    if (!this.config.ecsClusterArn)
      throw new Error("ECS cluster ARN is not configured");
    return this.config.ecsClusterArn;
  }

  private efsFileSystemId(): string {
    if (!this.config.efsFileSystemId)
      throw new Error("EFS filesystem ID is not configured");
    return this.config.efsFileSystemId;
  }

  private async sendEcs<T = unknown>(command: SendableCommand): Promise<T> {
    return (await this.ecs.send(command)) as T;
  }

  private async sendLogs<T = unknown>(command: SendableCommand): Promise<T> {
    return (await this.logsClient.send(command)) as T;
  }
}

function awsClient(client: {
  send(command: never): Promise<unknown>;
}): AwsClientLike {
  return {
    send: (command) => client.send(command as never),
  };
}

function assertEcsCompatibleSpec(spec: ManagedContainerCreateSpec): void {
  if (spec.security?.privileged)
    throw new Error("ECS sandbox tasks cannot run privileged containers");
  for (const mount of spec.mounts) {
    if (mount.kind !== "efs") {
      throw new Error(
        `ECS sandbox tasks require EFS mounts; unsupported mount kind ${mount.kind} at ${mount.target}`,
      );
    }
    if (!mount.name?.startsWith("/")) {
      throw new Error(
        `ECS EFS mount ${mount.target} must set VolumeRef.name to an absolute EFS root directory`,
      );
    }
  }
  if (!spec.mounts.some((mount) => mount.target === "/tmp")) {
    throw new Error("ECS sandbox tasks require a writable EFS /tmp mount");
  }
}

function ecsTags(spec: ManagedContainerCreateSpec): EcsTag[] {
  const base = new Map<string, string>(Object.entries(spec.labels));
  base.set(SPEC_LABEL, "v1");
  base.set(SANDBOX_ID_LABEL, spec.sandboxId);
  base.set(INSTANCE_LABEL, spec.instanceId);
  base.set("org.nerve.sandbox.manager", STARTED_BY);
  return Array.from(base.entries()).map(([key, value]) => ({ key, value }));
}

const FARGATE_RESOURCE_PRESETS = [
  { cpuUnits: 256, vcpu: 0.25, memoryMb: [512, 1024, 2048] },
  { cpuUnits: 512, vcpu: 0.5, memoryMb: range(1024, 4096, 1024) },
  { cpuUnits: 1024, vcpu: 1, memoryMb: range(2048, 8192, 1024) },
  { cpuUnits: 2048, vcpu: 2, memoryMb: range(4096, 16384, 1024) },
  { cpuUnits: 4096, vcpu: 4, memoryMb: range(8192, 30720, 1024) },
  { cpuUnits: 8192, vcpu: 8, memoryMb: range(16384, 61440, 4096) },
  { cpuUnits: 16384, vcpu: 16, memoryMb: range(32768, 122880, 8192) },
];

function fargateResourceOptions(): RuntimeDriverCapabilities["resourceOptions"] {
  return {
    memoryMb: { min: 512, max: 122880, step: 512, default: 4096 },
    vcpu: { min: 0.25, max: 16, step: 0.25, default: 1 },
    cpuUnits: { min: 256, max: 16384, step: 256, default: 1024 },
    fargate: { presets: FARGATE_RESOURCE_PRESETS },
  };
}

function ecsTaskCpu(resources: RuntimeResourceSpec | undefined): string {
  if (resources?.cpuUnits) return String(resources.cpuUnits);
  if (resources?.vcpu)
    return String(Math.max(256, Math.round(resources.vcpu * 1024)));
  return "1024";
}

function assertValidFargateResources(cpuUnits: number, memoryMb: number): void {
  const preset = FARGATE_RESOURCE_PRESETS.find(
    (entry) => entry.cpuUnits === cpuUnits,
  );
  if (!preset) {
    throw new Error(
      `Invalid ECS/Fargate CPU units ${cpuUnits}; choose one of ${FARGATE_RESOURCE_PRESETS.map((entry) => entry.cpuUnits).join(", ")}`,
    );
  }
  if (!preset.memoryMb.includes(memoryMb)) {
    throw new Error(
      `Invalid ECS/Fargate memory ${memoryMb} MB for CPU ${cpuUnits}; valid values are ${preset.memoryMb.join(", ")}`,
    );
  }
}

function range(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let value = min; value <= max; value += step) values.push(value);
  return values;
}

function linuxParameters(
  spec: ManagedContainerCreateSpec,
): Record<string, unknown> | undefined {
  const add = spec.security?.capAdd;
  const drop = spec.security?.capDrop;
  if (!add?.length && !drop?.length) return undefined;
  return { capabilities: { add, drop } };
}

function healthCheck(
  spec: ManagedContainerCreateSpec,
): HealthCheck | undefined {
  if (!spec.healthcheck) return undefined;
  return {
    command: ["CMD", ...spec.healthcheck.command],
    interval: millisecondsToSeconds(spec.healthcheck.intervalMs),
    timeout: millisecondsToSeconds(spec.healthcheck.timeoutMs),
    retries: spec.healthcheck.retries,
    startPeriod: millisecondsToSeconds(spec.healthcheck.startPeriodMs),
  };
}

function millisecondsToSeconds(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.ceil(value / 1000);
}

function ecsVolumeName(mount: VolumeRef, index: number): string {
  const target = mount.target
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `efs-${index}-${target || "root"}`.slice(0, 64);
}

function taskFamily(
  prefix: string,
  spec: Pick<ManagedContainerCreateSpec, "sandboxId" | "instanceId">,
): string {
  return `${safe(prefix)}-${safe(spec.sandboxId)}-${safe(spec.instanceId)}`.slice(
    0,
    255,
  );
}

function containerName(
  spec: Pick<ManagedContainerCreateSpec, "sandboxId" | "instanceId">,
): string {
  return `nerve-${safe(spec.sandboxId)}-${safe(spec.instanceId)}`.slice(0, 255);
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "x";
}

function preferredContainer(
  task: EcsTask,
  containerName: string,
): EcsTaskContainer | undefined {
  return (
    task.containers?.find((container) => container.name === containerName) ??
    task.containers?.[0]
  );
}

function mapEcsState(
  status: string | undefined,
): ManagedContainerStatus["state"] {
  if (
    status === "PROVISIONING" ||
    status === "PENDING" ||
    status === "ACTIVATING"
  )
    return "starting";
  if (status === "RUNNING") return "running";
  if (status === "DEACTIVATING" || status === "STOPPING") return "stopping";
  if (status === "DEPROVISIONING" || status === "STOPPED") return "exited";
  return "unknown";
}

function mapEcsHealth(
  status: string | undefined,
): ManagedContainerStatus["health"] {
  if (status === "HEALTHY") return "healthy";
  if (status === "UNHEALTHY") return "unhealthy";
  if (status === "UNKNOWN") return "unknown";
  return undefined;
}

function normalizeDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function tagMap(tags: EcsTag[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of tags ?? []) {
    if (tag.key && tag.value) map.set(tag.key, tag.value);
  }
  return map;
}

function taskNameFromTags(tags: Map<string, string>, taskArn: string): string {
  const sandboxId = tags.get(SANDBOX_ID_LABEL) ?? lastArnSegment(taskArn);
  const instanceId = tags.get(INSTANCE_LABEL) ?? lastArnSegment(taskArn);
  return `nerve-${safe(sandboxId)}-${safe(instanceId)}`.slice(0, 255);
}

function compactMetadata(
  entries: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

function lastArnSegment(value: string): string {
  return value.split("/").pop() || value.split(":").pop() || value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ecsLimitations(): string[] {
  return [
    "ECS/Fargate does not support tmpfs; /tmp must be an EFS mount",
    "ECS/Fargate does not support arbitrary POSIX signals; kill maps to StopTask",
    "ECS/Fargate pids limits are not mapped by this driver",
    "ECS task definitions do not expose Docker no-new-privileges; use task roles and security groups for AWS isolation",
  ];
}
