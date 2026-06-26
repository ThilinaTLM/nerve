import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

describe("orchestrator server pinned commands", () => {
  it("creates, lists, and deletes pinned commands", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-pinned-project-");
      const project = await state.registry.createProject({ dir: projectRoot });
      const jsonHeaders = { ...headers, "content-type": "application/json" };

      const empty = await app.request(
        `/api/projects/${project.id}/pinned-commands`,
        { headers },
      );
      assert.equal(empty.status, 200);
      assert.deepEqual(
        ((await empty.json()) as { commands: unknown[] }).commands,
        [],
      );

      const created = await app.request(
        `/api/projects/${project.id}/pinned-commands`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ command: "pnpm dev", label: "Dev server" }),
        },
      );
      assert.equal(created.status, 201);
      const { command } = (await created.json()) as {
        command: {
          id: string;
          command: string;
          label?: string;
          cwd?: string;
          updatedAt: string;
        };
      };
      assert.ok(command.id.startsWith("pin_"));
      assert.equal(command.command, "pnpm dev");
      assert.equal(command.label, "Dev server");

      const edited = await app.request(
        `/api/projects/${project.id}/pinned-commands/${command.id}`,
        {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({
            command: "pnpm test",
            label: "Tests",
            cwd: projectRoot,
          }),
        },
      );
      assert.equal(edited.status, 200);
      const { command: updated } = (await edited.json()) as {
        command: {
          id: string;
          command: string;
          label?: string;
          cwd?: string;
          updatedAt: string;
        };
      };
      assert.equal(updated.id, command.id);
      assert.equal(updated.command, "pnpm test");
      assert.equal(updated.label, "Tests");
      assert.equal(updated.cwd, projectRoot);
      assert.ok(Date.parse(updated.updatedAt) >= Date.parse(command.updatedAt));

      const listed = await app.request(
        `/api/projects/${project.id}/pinned-commands`,
        { headers },
      );
      const listedCommands = (
        (await listed.json()) as {
          commands: Array<{
            id: string;
            command: string;
            label?: string;
            cwd?: string;
          }>;
        }
      ).commands;
      assert.equal(listedCommands.length, 1);
      assert.equal(listedCommands[0]?.id, command.id);
      assert.equal(listedCommands[0]?.command, "pnpm test");
      assert.equal(listedCommands[0]?.label, "Tests");
      assert.equal(listedCommands[0]?.cwd, projectRoot);

      const missingEdit = await app.request(
        `/api/projects/${project.id}/pinned-commands/pin_missing`,
        {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ command: "pnpm build" }),
        },
      );
      assert.equal(missingEdit.status, 404);

      const removed = await app.request(
        `/api/projects/${project.id}/pinned-commands/${command.id}`,
        { method: "DELETE", headers },
      );
      assert.equal(removed.status, 204);

      const missing = await app.request(
        `/api/projects/${project.id}/pinned-commands/${command.id}`,
        { method: "DELETE", headers },
      );
      assert.equal(missing.status, 404);

      const afterDelete = await app.request(
        `/api/projects/${project.id}/pinned-commands`,
        { headers },
      );
      assert.deepEqual(
        ((await afterDelete.json()) as { commands: unknown[] }).commands,
        [],
      );
    } finally {
      state.index.close();
    }
  });
});
