import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ScratchNote } from "@nervekit/contracts";
import { HttpError } from "../src/http/errors.js";
import { readJsonFile } from "../src/infrastructure/storage/index.js";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

describe("orchestrator scratch notes", () => {
  it("creates, partially updates, and deletes multiple notes", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-project-"),
      });

      assert.deepEqual(await state.registry.listScratchNotes(project.id), []);

      const [first, second] = await Promise.all([
        state.registry.createScratchNote(project.id, {}),
        state.registry.createScratchNote(project.id, {
          title: "Release checklist",
          content: "- tests",
        }),
      ]);
      assert.equal(first.title, "Untitled note");
      assert.equal(first.content, "");
      assert.equal(second.title, "Release checklist");
      assert.equal(second.content, "- tests");

      const renamed = await state.registry.updateScratchNote(
        project.id,
        second.id,
        { title: "Ship checklist" },
      );
      assert.equal(renamed.title, "Ship checklist");
      assert.equal(renamed.content, "- tests");

      const edited = await state.registry.updateScratchNote(
        project.id,
        second.id,
        { content: "- tests\n- docs" },
      );
      assert.equal(edited.title, "Ship checklist");
      assert.equal(edited.content, "- tests\n- docs");
      assert.ok(Date.parse(edited.updatedAt) > 0);

      await state.registry.removeScratchNote(project.id, first.id);
      const remaining = await state.registry.listScratchNotes(project.id);
      assert.deepEqual(
        remaining.map((note) => note.id),
        [second.id],
      );

      await assert.rejects(
        state.registry.updateScratchNote(project.id, "note_missing", {
          title: "Missing",
        }),
        (error: unknown) =>
          error instanceof HttpError &&
          error.status === 404 &&
          error.code === "SCRATCH_NOTE_NOT_FOUND",
      );
      await assert.rejects(
        state.registry.removeScratchNote(project.id, "note_missing"),
        (error: unknown) => error instanceof HttpError && error.status === 404,
      );
    } finally {
      state.index.close();
    }
  });

  it("keeps note collections isolated between projects", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const projectA = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-a-"),
      });
      const projectB = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-b-"),
      });

      const noteA = await state.registry.createScratchNote(projectA.id, {
        content: "notes for A",
      });
      assert.deepEqual(await state.registry.listScratchNotes(projectB.id), []);
      assert.equal(
        (await state.registry.listScratchNotes(projectA.id))[0]?.id,
        noteA.id,
      );
    } finally {
      state.index.close();
    }
  });

  it("migrates legacy single-note storage without resurrecting deleted notes", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-legacy-"),
      });
      const projectStorage = join(
        state.storage.paths.home,
        "projects",
        project.id,
      );
      const legacyPath = join(projectStorage, "scratch-note.json");
      const pluralPath = join(projectStorage, "scratch-notes.json");
      await mkdir(projectStorage, { recursive: true });
      await writeFile(
        legacyPath,
        JSON.stringify({
          projectId: project.id,
          content: "legacy content",
          updatedAt: "2025-01-02T03:04:05.000Z",
        }),
      );

      const migrated = await state.registry.listScratchNotes(project.id);
      assert.equal(migrated.length, 1);
      assert.equal(migrated[0]?.title, "Untitled note");
      assert.equal(migrated[0]?.content, "legacy content");
      assert.equal(migrated[0]?.createdAt, "2025-01-02T03:04:05.000Z");
      await assert.rejects(access(legacyPath));
      const persisted = await readJsonFile<ScratchNote[]>(pluralPath);
      assert.equal(persisted[0]?.id, migrated[0]?.id);

      await state.registry.removeScratchNote(project.id, migrated[0]!.id);
      assert.deepEqual(await state.registry.listScratchNotes(project.id), []);

      const emptyProject = await state.registry.createProject({
        dir: await tempHome("nerve-scratch-empty-legacy-"),
      });
      const emptyStorage = join(
        state.storage.paths.home,
        "projects",
        emptyProject.id,
      );
      await mkdir(emptyStorage, { recursive: true });
      await writeFile(
        join(emptyStorage, "scratch-note.json"),
        JSON.stringify({
          projectId: emptyProject.id,
          content: "",
          updatedAt: new Date(0).toISOString(),
        }),
      );
      assert.deepEqual(
        await state.registry.listScratchNotes(emptyProject.id),
        [],
      );
      assert.deepEqual(
        await readJsonFile(join(emptyStorage, "scratch-notes.json")),
        [],
      );
    } finally {
      state.index.close();
    }
  });
});
