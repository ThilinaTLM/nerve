import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadManagerConfig } from "../src/config/manager-config.js";

describe("sandbox manager config", () => {
  it("defaults the local container backend to auto", () => {
    assert.equal(loadManagerConfig(baseEnv()).backend, "auto");
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
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NERVE_SANDBOX_MANAGER_DATABASE_URL:
      "postgres://postgres:postgres@127.0.0.1:5432/nerve_test",
  };
}
