import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../../../src/core/application-error.js";
import {
  createAuthenticatedApp,
  tempHome,
} from "../../helpers/server-routes.js";

describe("orchestrator scratch notes", () => {
  it("creates, partially updates, and deletes multiple notes", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: await tempHome("nerve-scratch-project-"),
      });

      assert.deepEqual(await state.services.scratchNotes.list(project.id), []);

      const [first, second] = await Promise.all([
        state.services.scratchNotes.create(project.id, {}),
        state.services.scratchNotes.create(project.id, {
          title: "Release checklist",
          content: "- tests",
        }),
      ]);
      assert.equal(first.title, "Untitled note");
      assert.equal(first.content, "");
      assert.equal(second.title, "Release checklist");
      assert.equal(second.content, "- tests");

      const renamed = await state.services.scratchNotes.update(
        project.id,
        second.id,
        { title: "Ship checklist" },
      );
      assert.equal(renamed.title, "Ship checklist");
      assert.equal(renamed.content, "- tests");

      const edited = await state.services.scratchNotes.update(
        project.id,
        second.id,
        { content: "- tests\n- docs" },
      );
      assert.equal(edited.title, "Ship checklist");
      assert.equal(edited.content, "- tests\n- docs");
      assert.ok(Date.parse(edited.updatedAt) > 0);

      await state.services.scratchNotes.remove(project.id, first.id);
      const remaining = await state.services.scratchNotes.list(project.id);
      assert.deepEqual(
        remaining.map((note) => note.id),
        [second.id],
      );

      await assert.rejects(
        state.services.scratchNotes.update(project.id, "note_missing", {
          title: "Missing",
        }),
        (error: unknown) =>
          error instanceof ApplicationError &&
          error.status === 404 &&
          error.code === "SCRATCH_NOTE_NOT_FOUND",
      );
      await assert.rejects(
        state.services.scratchNotes.remove(project.id, "note_missing"),
        (error: unknown) =>
          error instanceof ApplicationError && error.status === 404,
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("keeps note collections isolated between projects", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const projectA = await state.services.projectLifecycle.createProject({
        dir: await tempHome("nerve-scratch-a-"),
      });
      const projectB = await state.services.projectLifecycle.createProject({
        dir: await tempHome("nerve-scratch-b-"),
      });

      const noteA = await state.services.scratchNotes.create(projectA.id, {
        content: "notes for A",
      });
      assert.deepEqual(await state.services.scratchNotes.list(projectB.id), []);
      assert.equal(
        (await state.services.scratchNotes.list(projectA.id))[0]?.id,
        noteA.id,
      );
    } finally {
      state.queryCache.close();
    }
  });
});
