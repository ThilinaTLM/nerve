import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gitEventRefreshRequest } from "./git-event-policy.js";

void describe("Git event refresh policy", () => {
  void it("maps filesystem and mutation reasons to the narrowest demand", () => {
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.invalidated",
        data: {
          projectId: "proj_one",
          repo: ".",
          generation: 1,
          fullRefreshRequired: false,
        },
      }),
      { projectId: "proj_one", repo: ".", demand: { overview: true } },
    );
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.changed",
        data: {
          projectId: "proj_one",
          repo: ".",
          reason: "file.staged",
        },
      }),
      { projectId: "proj_one", repo: ".", demand: { overview: true } },
    );
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.changed",
        data: {
          projectId: "proj_one",
          repo: ".",
          reason: "remote.pushed",
        },
      }),
      {
        projectId: "proj_one",
        repo: ".",
        demand: { overview: true },
      },
    );
  });

  void it("only explicitly uncertain notices select non-forced refresh mode", () => {
    const data = {
      projectId: "proj_one",
      repo: ".",
      generation: 2,
      fullRefreshRequired: true,
    };
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.invalidated",
        data: { ...data, refreshCause: "uncertain_poll" },
      })?.demand,
      { overview: true, uncertain: true },
    );
    assert.deepEqual(
      gitEventRefreshRequest({ type: "git.repository.invalidated", data })
        ?.demand,
      { overview: true },
    );
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.changed",
        data: {
          ...data,
          reason: "remote.fetched",
          refreshCause: "uncertain_poll",
        },
      })?.demand,
      { overview: true },
      "actual mutation success remains hard even if an unrelated marker is present",
    );
  });

  void it("refreshes discovery after clone and Git state after merge", () => {
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.changed",
        data: {
          projectId: "proj_one",
          repo: "new",
          reason: "repository.cloned",
        },
      }),
      {
        projectId: "proj_one",
        repo: "new",
        refreshDiscovery: true,
        demand: { overview: true },
      },
    );
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.changed",
        data: { projectId: "proj_one", repo: ".", reason: "github.pr.merged" },
      }),
      {
        projectId: "proj_one",
        repo: ".",
        demand: { overview: true },
      },
    );
  });

  void it("ignores malformed, project-less, and unrelated events", () => {
    assert.equal(
      gitEventRefreshRequest({
        type: "git.repository.changed",
        data: { repo: ".", reason: "remote.pushed" },
      }),
      undefined,
    );
    assert.equal(
      gitEventRefreshRequest({
        type: "project.updated",
        data: { projectId: "proj_one", repo: "." },
      }),
      undefined,
    );
  });
});
