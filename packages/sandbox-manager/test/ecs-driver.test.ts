import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ManagedContainerCreateSpec,
  SandboxConfigV1,
} from "@nervekit/contracts";
import {
  loadManagerConfig,
  type ManagerConfig,
} from "../src/config/manager-config.js";
import { buildSandboxLaunchSpec } from "../src/config/sandbox-launch-spec.js";
import {
  type AwsClientLike,
  EcsContainerDriver,
} from "../src/drivers/ecs-driver.js";

function managerConfig(
  overrides: Record<string, string | undefined> = {},
): ManagerConfig {
  return loadManagerConfig({
    NERVE_SANDBOX_MANAGER_DATABASE_URL:
      "postgres://postgres:postgres@127.0.0.1:5432/nerve_test",
    NERVE_SANDBOX_MANAGER_BACKEND: "ecs",
    NERVE_SANDBOX_MANAGER_VOLUME_BACKEND: "efs",
    NERVE_SANDBOX_MANAGER_AWS_REGION: "us-east-1",
    NERVE_SANDBOX_MANAGER_ECS_CLUSTER_ARN:
      "arn:aws:ecs:us-east-1:123456789012:cluster/nerve",
    NERVE_SANDBOX_MANAGER_ECS_SUBNETS: "subnet-1,subnet-2",
    NERVE_SANDBOX_MANAGER_ECS_SECURITY_GROUPS: "sg-1",
    NERVE_SANDBOX_MANAGER_ECS_TASK_EXECUTION_ROLE_ARN:
      "arn:aws:iam::123456789012:role/execution",
    NERVE_SANDBOX_MANAGER_ECS_SANDBOX_TASK_ROLE_ARN:
      "arn:aws:iam::123456789012:role/sandbox",
    NERVE_SANDBOX_MANAGER_ECS_LOG_GROUP: "/aws/ecs/nerve-sandbox",
    NERVE_SANDBOX_MANAGER_EFS_FILE_SYSTEM_ID: "fs-123",
    NERVE_SANDBOX_MANAGER_EFS_MOUNT_ROOT: "/mnt/efs",
    NERVE_SANDBOX_MANAGER_EFS_ROOT_DIRECTORY: "/nerve/sandboxes",
    ...overrides,
  });
}

function sandboxConfig(): SandboxConfigV1 {
  return {
    version: 1,
    agent: {
      defaultModel: { provider: "openai-codex", model: "gpt-5.4-mini" },
    },
    controller: {
      websocket: { url: "ws://manager/api/sandboxes/sbx_1/ws" },
      auth: { type: "api_key", apiKey: "x" },
    },
  } as unknown as SandboxConfigV1;
}

function ecsSpec(): ManagedContainerCreateSpec {
  return buildSandboxLaunchSpec(sandboxConfig(), {
    image: "agent:dev",
    sandboxId: "sbx_1",
    managerBaseUrl: "http://manager",
    backend: "ecs",
    runtimeMounts: {
      workspace: {
        kind: "efs",
        name: "/nerve/sandboxes/sbx_1/workspace",
        target: "/workspace",
      },
      state: {
        kind: "efs",
        name: "/nerve/sandboxes/sbx_1/state",
        target: "/state",
      },
      config: {
        kind: "efs",
        name: "/nerve/sandboxes/sbx_1/config",
        target: "/etc/nerve",
        readonly: true,
      },
      secrets: {
        kind: "efs",
        name: "/nerve/sandboxes/sbx_1/secrets",
        target: "/secrets",
        readonly: true,
      },
      tmp: {
        kind: "efs",
        name: "/nerve/sandboxes/sbx_1/tmp",
        target: "/tmp",
      },
    },
  });
}

type AwsCommand = Parameters<AwsClientLike["send"]>[0];

class FakeAwsClient implements AwsClientLike {
  readonly commands: AwsCommand[] = [];

  constructor(
    private readonly handler: (name: string, input: unknown) => unknown,
  ) {}

  async send(command: AwsCommand): Promise<unknown> {
    this.commands.push(command);
    return this.handler(command.constructor.name, command.input);
  }

  input(name: string): Record<string, unknown> {
    return this.commands.find((command) => command.constructor.name === name)
      ?.input as Record<string, unknown>;
  }
}

describe("EcsContainerDriver", () => {
  it("registers a Fargate task definition and runs one sandbox task", async () => {
    const ecs = new FakeAwsClient((name) => {
      if (name === "RegisterTaskDefinitionCommand") {
        return { taskDefinition: { taskDefinitionArn: "task-def-arn" } };
      }
      if (name === "RunTaskCommand") {
        return {
          tasks: [
            {
              taskArn: "arn:aws:ecs:us-east-1:123456789012:task/nerve/task-1",
            },
          ],
        };
      }
      return {};
    });
    const driver = new EcsContainerDriver(managerConfig(), {
      ecs,
      logs: new FakeAwsClient(() => ({})),
    });

    const ref = await driver.create(ecsSpec());

    assert.equal(ref.kind, "ecs");
    assert.equal(ref.metadata?.taskDefinitionArn, "task-def-arn");
    assert.equal(ref.metadata?.logStream, "sandbox/sandbox-agent/task-1");
    const registerInput = ecs.input("RegisterTaskDefinitionCommand");
    assert.equal(registerInput.networkMode, "awsvpc");
    assert.deepEqual(registerInput.requiresCompatibilities, ["FARGATE"]);
    const volumes = registerInput.volumes as Array<{
      efsVolumeConfiguration: { rootDirectory: string };
    }>;
    assert.equal(
      volumes[0].efsVolumeConfiguration.rootDirectory,
      "/nerve/sandboxes/sbx_1/workspace",
    );
    const containers = registerInput.containerDefinitions as Array<{
      mountPoints: Array<{ containerPath: string }>;
      logConfiguration: { options: Record<string, string> };
      environment: Array<{ name: string; value: string }>;
    }>;
    assert.equal(containers[0].mountPoints.at(-1)?.containerPath, "/tmp");
    assert.equal(
      containers[0].logConfiguration.options["awslogs-group"],
      "/aws/ecs/nerve-sandbox",
    );
    assert.ok(
      containers[0].environment.some(
        (entry) => entry.name === "NERVE_SANDBOX_AGENT_INSTANCE_ID",
      ),
    );
    const runInput = ecs.input("RunTaskCommand");
    assert.equal(runInput.startedBy, "nerve-sandbox-manager");
    assert.equal(runInput.launchType, "FARGATE");
    assert.deepEqual(
      (
        runInput.networkConfiguration as {
          awsvpcConfiguration: { subnets: string[] };
        }
      ).awsvpcConfiguration.subnets,
      ["subnet-1", "subnet-2"],
    );
  });

  it("runs sandbox tasks with a capacity provider strategy when configured", async () => {
    const ecs = new FakeAwsClient((name) => {
      if (name === "RegisterTaskDefinitionCommand") {
        return { taskDefinition: { taskDefinitionArn: "task-def-arn" } };
      }
      if (name === "RunTaskCommand") {
        return {
          tasks: [
            {
              taskArn: "arn:aws:ecs:us-east-1:123456789012:task/nerve/task-1",
            },
          ],
        };
      }
      return {};
    });
    const driver = new EcsContainerDriver(
      managerConfig({
        NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY: JSON.stringify([
          { capacityProvider: "FARGATE_SPOT", weight: 1 },
        ]),
      }),
      {
        ecs,
        logs: new FakeAwsClient(() => ({})),
      },
    );

    await driver.create(ecsSpec());

    const runInput = ecs.input("RunTaskCommand");
    assert.equal(runInput.launchType, undefined);
    assert.deepEqual(runInput.capacityProviderStrategy, [
      { capacityProvider: "FARGATE_SPOT", weight: 1 },
    ]);
  });

  it("maps ECS task state and reads CloudWatch logs", async () => {
    const ecs = new FakeAwsClient((name) => {
      if (name === "DescribeTasksCommand") {
        return {
          tasks: [
            {
              lastStatus: "STOPPED",
              stoppedAt: new Date("2026-07-01T00:00:00.000Z"),
              containers: [
                {
                  name: "sandbox-agent",
                  exitCode: 22,
                  healthStatus: "UNHEALTHY",
                },
              ],
            },
          ],
        };
      }
      return {};
    });
    const logs = new FakeAwsClient((name) => {
      if (name === "GetLogEventsCommand") {
        return {
          events: [{ timestamp: 1_788_000_000_000, message: "hello" }],
          nextForwardToken: "done",
        };
      }
      return {};
    });
    const driver = new EcsContainerDriver(managerConfig(), { ecs, logs });
    const ref = {
      kind: "ecs",
      id: "task-arn",
      metadata: {
        clusterArn: managerConfig().ecsClusterArn ?? "",
        logGroup: "/aws/ecs/nerve-sandbox",
        logStream: "sandbox/sandbox-agent/task-1",
      },
    };

    const status = await driver.inspect(ref);
    assert.equal(status.state, "exited");
    assert.equal(status.exitCode, 22);
    assert.equal(status.health, "unhealthy");

    const chunks = [];
    for await (const chunk of driver.logs(ref, { tail: 1 })) chunks.push(chunk);
    assert.equal(chunks[0].chunk, "hello\n");
    assert.equal(
      logs.input("GetLogEventsCommand").logStreamName,
      "sandbox/sandbox-agent/task-1",
    );
  });

  it("stops tasks, deregisters task definitions, and lists managed tasks", async () => {
    const ecs = new FakeAwsClient((name) => {
      if (name === "ListTasksCommand") return { taskArns: ["task-arn"] };
      if (name === "DescribeTasksCommand") {
        return {
          tasks: [
            {
              taskArn: "task-arn",
              taskDefinitionArn: "task-def-arn",
              clusterArn: managerConfig().ecsClusterArn,
              tags: [
                { key: "org.nerve.sandbox.spec", value: "v1" },
                { key: "org.nerve.sandbox.id", value: "sbx_1" },
                { key: "org.nerve.sandbox.instance", value: "inst_1" },
              ],
            },
          ],
        };
      }
      return {};
    });
    const driver = new EcsContainerDriver(managerConfig(), {
      ecs,
      logs: new FakeAwsClient(() => ({})),
    });
    const ref = {
      kind: "ecs",
      id: "task-arn",
      metadata: { taskDefinitionArn: "task-def-arn" },
    };

    await driver.stop(ref);
    await driver.remove(ref);
    const refs = await driver.listManaged();

    assert.ok(
      ecs.commands.some(
        (command) => command.constructor.name === "StopTaskCommand",
      ),
    );
    assert.ok(
      ecs.commands.some(
        (command) =>
          command.constructor.name === "DeregisterTaskDefinitionCommand",
      ),
    );
    assert.equal(refs[0].metadata?.sandboxId, "sbx_1");
  });
});
