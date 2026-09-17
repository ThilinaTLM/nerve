import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPr } from "@nervekit/contracts/git";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import {
  pullRequestReferenceCompletions,
  taskReferenceCompletions,
} from "./composer-reference-completions";

function task(
  id: string,
  status: TaskRecord["status"],
  updatedAt: string,
  displayName?: string,
): TaskRecord {
  return {
    id,
    status,
    updatedAt,
    startedAt: updatedAt,
    displayName,
    command: `run-${id}`,
    cwd: "/project",
  } as TaskRecord;
}

describe("composer reference completions", () => {
  it("puts matching active tasks first and inserts stable task IDs", () => {
    const items = taskReferenceCompletions(
      [
        task("task_old", "completed", "2026-01-03T00:00:00.000Z", "Build"),
        task("task_live", "running", "2026-01-01T00:00:00.000Z", "Dev server"),
      ],
      "",
    );

    assert.deepEqual(
      items.map((item) => item.label),
      ["task_live", "task_old"],
    );
    assert.equal(items[0]?.displayLabel, "Dev server");
    assert.deepEqual(
      taskReferenceCompletions(
        [
          task(
            "task_live",
            "running",
            "2026-01-01T00:00:00.000Z",
            "Dev server",
          ),
        ],
        "server",
      ).map((item) => item.label),
      ["task_live"],
    );
  });

  it("matches PR metadata and inserts repository-qualified numbers", () => {
    const prs = [
      {
        number: 42,
        title: "Improve composer",
        author: "octocat",
        headRefName: "composer",
        baseRefName: "main",
        state: "OPEN",
        url: "https://github.com/acme/app/pull/42",
      },
    ] as GithubPr[];

    const items = pullRequestReferenceCompletions(prs, "packages/app", "octo");
    assert.equal(items[0]?.label, "https://github.com/acme/app/pull/42");
    assert.equal(items[0]?.displayLabel, "#42 Improve composer");
    assert.equal(
      pullRequestReferenceCompletions(prs, ".", "42")[0]?.detail,
      "OPEN · https://github.com/acme/app/pull/42",
    );
  });
});
