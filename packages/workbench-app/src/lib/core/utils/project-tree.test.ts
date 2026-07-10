import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRecord, ProjectRecord } from "$lib/api";
import { buildConversationRows, buildProjectGroups } from "./project-tree";

function project(
  patch: Partial<ProjectRecord> & Pick<ProjectRecord, "id" | "dir">,
): ProjectRecord {
  const { id, dir, ...rest } = patch;
  return {
    id,
    name: dir.split("/").at(-1) ?? dir,
    dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  };
}

function conversation(
  patch: Partial<ConversationRecord> &
    Pick<ConversationRecord, "id" | "projectId">,
): ConversationRecord {
  const { id, projectId, ...rest } = patch;
  return {
    id,
    projectId,
    title: id,
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: { autoApproveReadOnly: true },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  };
}

describe("project tree ordering", () => {
  it("sorts conversations by last user message time, not updatedAt", () => {
    const projectId = "proj_01HN0000000000000000000000";
    const olderUserMessage = conversation({
      id: "conv_01HN0000000000000000000000",
      projectId,
      updatedAt: "2026-01-01T00:20:00.000Z",
      lastUserMessageAt: "2026-01-01T00:10:00.000Z",
    });
    const newerUserMessage = conversation({
      id: "conv_01HN0000000000000000000001",
      projectId,
      updatedAt: "2026-01-01T00:16:00.000Z",
      lastUserMessageAt: "2026-01-01T00:15:00.000Z",
    });

    const rows = buildConversationRows({
      conversations: [olderUserMessage, newerUserMessage],
      agents: [],
      projectIds: [projectId],
    });

    assert.deepEqual(
      rows.map((row) => row.conversation.id),
      [newerUserMessage.id, olderUserMessage.id],
    );
  });

  it("sorts project groups by the newest child user message", () => {
    const olderProject = project({
      id: "proj_01HN0000000000000000000000",
      dir: "/tmp/older",
      updatedAt: "2026-01-01T00:30:00.000Z",
    });
    const newerProject = project({
      id: "proj_01HN0000000000000000000001",
      dir: "/tmp/newer",
      updatedAt: "2026-01-01T00:10:00.000Z",
    });

    const result = buildProjectGroups({
      projects: [olderProject, newerProject],
      conversations: [
        conversation({
          id: "conv_01HN0000000000000000000000",
          projectId: olderProject.id,
          lastUserMessageAt: "2026-01-01T00:05:00.000Z",
          updatedAt: "2026-01-01T00:30:00.000Z",
        }),
        conversation({
          id: "conv_01HN0000000000000000000001",
          projectId: newerProject.id,
          lastUserMessageAt: "2026-01-01T00:15:00.000Z",
          updatedAt: "2026-01-01T00:10:00.000Z",
        }),
      ],
      agents: [],
    });

    assert.deepEqual(
      result.groups.map((group) => group.project.id),
      [newerProject.id, olderProject.id],
    );
  });

  it("falls back to createdAt when a conversation has no user message timestamp", () => {
    const projectId = "proj_01HN0000000000000000000000";
    const olderCreated = conversation({
      id: "conv_01HN0000000000000000000000",
      projectId,
      createdAt: "2026-01-01T00:12:00.000Z",
      updatedAt: "2026-01-01T00:50:00.000Z",
    });
    const newerCreated = conversation({
      id: "conv_01HN0000000000000000000001",
      projectId,
      createdAt: "2026-01-01T00:13:00.000Z",
      updatedAt: "2026-01-01T00:14:00.000Z",
    });

    const rows = buildConversationRows({
      conversations: [olderCreated, newerCreated],
      agents: [],
      projectIds: [projectId],
    });

    assert.deepEqual(
      rows.map((row) => row.conversation.id),
      [newerCreated.id, olderCreated.id],
    );
  });
});
