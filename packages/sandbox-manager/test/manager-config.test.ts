import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadManagerConfig } from "../src/config/manager-config.js";

describe("sandbox manager config", () => {
  it("defaults the local container backend to auto", () => {
    assert.equal(loadManagerConfig(baseEnv()).backend, "auto");
  });

  it("parses the default sandbox image", () => {
    assert.equal(
      loadManagerConfig({
        ...baseEnv(),
        NERVE_SANDBOX_MANAGER_DEFAULT_SANDBOX_IMAGE: "agent:aws",
      }).defaultSandboxImage,
      "agent:aws",
    );
  });

  it("parses explicit local container backends", () => {
    assert.equal(
      loadManagerConfig({
        ...baseEnv(),
        NERVE_SANDBOX_MANAGER_BACKEND: "auto",
      }).backend,
      "auto",
    );
    assert.equal(
      loadManagerConfig({
        ...baseEnv(),
        NERVE_SANDBOX_MANAGER_BACKEND: "docker",
      }).backend,
      "docker",
    );
    assert.equal(
      loadManagerConfig({
        ...baseEnv(),
        NERVE_SANDBOX_MANAGER_BACKEND: "podman",
      }).backend,
      "podman",
    );
  });

  it("treats unknown backend values as auto", () => {
    assert.equal(
      loadManagerConfig({
        ...baseEnv(),
        NERVE_SANDBOX_MANAGER_BACKEND: "containerd",
      }).backend,
      "auto",
    );
  });

  it("parses ECS and EFS settings", () => {
    const config = loadManagerConfig({
      ...baseEnv(),
      NERVE_SANDBOX_MANAGER_BACKEND: "ecs",
      NERVE_SANDBOX_MANAGER_VOLUME_BACKEND: "efs",
      NERVE_SANDBOX_MANAGER_AWS_REGION: "us-east-1",
      NERVE_SANDBOX_MANAGER_ECS_CLUSTER_ARN:
        "arn:aws:ecs:us-east-1:123456789012:cluster/nerve",
      NERVE_SANDBOX_MANAGER_ECS_SUBNETS: "subnet-1,subnet-2",
      NERVE_SANDBOX_MANAGER_ECS_SECURITY_GROUPS: "sg-1 sg-2",
      NERVE_SANDBOX_MANAGER_ECS_TASK_EXECUTION_ROLE_ARN:
        "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
      NERVE_SANDBOX_MANAGER_EFS_FILE_SYSTEM_ID: "fs-123",
      NERVE_SANDBOX_MANAGER_EFS_MOUNT_ROOT: "/mnt/efs",
      NERVE_SANDBOX_MANAGER_EFS_ROOT_DIRECTORY: "nerve/sandboxes",
      NERVE_SANDBOX_MANAGER_ECS_LOG_GROUP: "/aws/ecs/nerve-sandbox",
    });
    assert.equal(config.backend, "ecs");
    assert.equal(config.volumeBackend, "efs");
    assert.deepEqual(config.ecsSubnets, ["subnet-1", "subnet-2"]);
    assert.deepEqual(config.ecsSecurityGroups, ["sg-1", "sg-2"]);
    assert.equal(config.efsRootDirectory, "/nerve/sandboxes");
    assert.equal(config.ecsLaunchType, "FARGATE");
  });

  it("rejects incomplete ECS configuration with actionable errors", () => {
    assert.throws(
      () =>
        loadManagerConfig({
          ...baseEnv(),
          NERVE_SANDBOX_MANAGER_BACKEND: "ecs",
        }),
      /VOLUME_BACKEND=efs.*ECS_CLUSTER_ARN.*ECS_SUBNETS.*EFS_FILE_SYSTEM_ID/s,
    );
  });

  it("parses trusted proxy UI cookie settings", () => {
    const config = loadManagerConfig({
      ...baseEnv(),
      NERVE_SANDBOX_MANAGER_UI_AUTH_COOKIE_MODE: "trusted_proxy",
      NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_CIDRS: "10.0.0.0/8,192.168.0.0/16",
      NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_AUTH_HEADER: "x-auth-request-user",
    });
    assert.equal(config.uiAuthCookieMode, "trusted_proxy");
    assert.deepEqual(config.trustedProxyCidrs, [
      "10.0.0.0/8",
      "192.168.0.0/16",
    ]);
    assert.equal(config.trustedProxyAuthHeader, "x-auth-request-user");
  });
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NERVE_SANDBOX_MANAGER_DATABASE_URL:
      "postgres://postgres:postgres@127.0.0.1:5432/nerve_test",
  };
}
