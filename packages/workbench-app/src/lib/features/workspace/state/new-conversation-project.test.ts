import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectRecord } from "$lib/api";
import { projectForNewConversation } from "./new-conversation-project";

const projects: ProjectRecord[] = [
  {
    id: "proj_existing",
    name: "existing",
    dir: "/projects/existing",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

test("uses an existing workspace project for a known directory", () => {
  assert.equal(
    projectForNewConversation(projects, "/projects/existing"),
    projects[0],
  );
});

test("requires project creation for an unknown directory", () => {
  assert.equal(projectForNewConversation(projects, "/projects/new"), undefined);
});
