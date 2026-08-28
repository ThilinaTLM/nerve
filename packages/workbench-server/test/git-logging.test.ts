import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GITHUB_REQUEST_SLOW_MS,
  GIT_COMMAND_SLOW_MS,
  GIT_OVERVIEW_SLOW_MS,
  GIT_READ_SLOW_MS,
  gitCommandDiagnostic,
  githubRequestDiagnostic,
  gitOverviewDiagnostic,
  gitReadDiagnostic,
} from "../src/app/runtime/git-logging.js";

describe("Git application log diagnostics", () => {
  it("omits routine successful observations and reports threshold boundaries", () => {
    assert.equal(
      gitCommandDiagnostic({
        bin: "git",
        command: "status",
        cwd: "/workspace/repo",
        durationMs: GIT_COMMAND_SLOW_MS - 1,
        succeeded: true,
      }),
      undefined,
    );
    assert.equal(
      gitReadDiagnostic({
        backend: "native",
        operation: "snapshot",
        repoDir: "/workspace/repo",
        durationMs: GIT_READ_SLOW_MS - 1,
        succeeded: true,
      }),
      undefined,
    );
    assert.equal(
      githubRequestDiagnostic({
        operation: "github-status",
        method: "POST",
        hostname: "github.com",
        owner: "nervekit",
        repository: "nerve",
        durationMs: GITHUB_REQUEST_SLOW_MS - 1,
        succeeded: true,
        status: 200,
      }),
      undefined,
    );
    assert.equal(
      gitOverviewDiagnostic({
        projectId: "proj_test",
        relativePath: ".",
        durationMs: GIT_OVERVIEW_SLOW_MS - 1,
        succeeded: true,
      }),
      undefined,
    );

    const command = gitCommandDiagnostic({
      bin: "git",
      command: "pull",
      cwd: "/workspace/repo",
      durationMs: GIT_COMMAND_SLOW_MS,
      succeeded: true,
    });
    assert.equal(command?.level, "warn");
    assert.equal(command?.message, "Slow Git command: git pull");
    assert.deepEqual(command?.details, {
      durationMs: GIT_COMMAND_SLOW_MS,
      context: {
        bin: "git",
        command: "pull",
        cwd: "/workspace/repo",
        outcome: "slow",
      },
    });
  });

  it("reports failures regardless of duration with useful identity", () => {
    const github = githubRequestDiagnostic({
      operation: "merge-pull-request",
      method: "PUT",
      hostname: "github.com",
      owner: "nervekit",
      repository: "nerve",
      durationMs: 12.4,
      succeeded: false,
      status: 403,
    });
    assert.equal(github?.message, "GitHub request failed: merge-pull-request");
    assert.deepEqual(github?.details, {
      durationMs: 12,
      context: {
        operation: "merge-pull-request",
        method: "PUT",
        hostname: "github.com",
        repository: "nervekit/nerve",
        status: 403,
        outcome: "failed",
      },
    });

    const overview = gitOverviewDiagnostic({
      projectId: "proj_test",
      relativePath: "packages/app",
      durationMs: 25,
      succeeded: false,
    });
    assert.equal(overview?.message, "Git overview failed: packages/app");
    assert.equal(overview?.details.projectId, "proj_test");
    assert.deepEqual(overview?.details.context, {
      relativePath: "packages/app",
      outcome: "failed",
    });
  });
});
