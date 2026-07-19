import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

describe("orchestrator scratch notes", () => {
  it("returns an empty note by default and persists updates per project", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-scratch-project-");
      const project = await state.registry.createProject({ dir: projectRoot });

      const initial = await state.registry.getScratchNote(project.id);
      assert.equal(initial.projectId, project.id);
      assert.equal(initial.content, "");

      const saved = await state.registry.updateScratchNote(project.id, {
        content: "- ship scratch notes\n- write tests",
      });
      assert.equal(saved.projectId, project.id);
      assert.equal(saved.content, "- ship scratch notes\n- write tests");
      assert.ok(Date.parse(saved.updatedAt) > 0);

      const reloaded = await state.registry.getScratchNote(project.id);
      assert.equal(reloaded.content, "- ship scratch notes\n- write tests");
      assert.equal(reloaded.updatedAt, saved.updatedAt);

      const cleared = await state.registry.updateScratchNote(project.id, {
        content: "",
      });
      assert.equal(cleared.content, "");
      const afterClear = await state.registry.getScratchNote(project.id);
      assert.equal(afterClear.content, "");
    } finally {
      state.index.close();
    }
  });

  it("keeps notes isolated between projects", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const projectA = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-a-"),
      });
      const projectB = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-b-"),
      });

      await state.registry.updateScratchNote(projectA.id, {
        content: "notes for A",
      });

      const noteB = await state.registry.getScratchNote(projectB.id);
      assert.equal(noteB.content, "");

      const noteA = await state.registry.getScratchNote(projectA.id);
      assert.equal(noteA.content, "notes for A");
    } finally {
      state.index.close();
    }
  });
});
