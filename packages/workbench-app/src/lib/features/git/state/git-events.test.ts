import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gitEventRefreshRequest } from "./git-event-policy.js";

describe("Git event refresh policy", () => {
  it("maps filesystem and mutation reasons to the narrowest demand", () => {
    assert.deepEqual(
      gitEventRefreshRequest({
        type: "git.repository.invalidated",
        data: {
          projectId: "proj_one",
          repo: ".",
          source: "filesystem",
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
        demand: { overview: true, prs: true },
      },
    );
  });

  it("ignores malformed, project-less, and unrelated events", () => {
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
