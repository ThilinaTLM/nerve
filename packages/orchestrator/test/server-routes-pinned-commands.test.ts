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
        command: { id: string; command: string; label?: string };
      };
      assert.ok(command.id.startsWith("pin_"));
      assert.equal(command.command, "pnpm dev");
      assert.equal(command.label, "Dev server");

      const listed = await app.request(
        `/api/projects/${project.id}/pinned-commands`,
        { headers },
      );
      assert.equal(
        ((await listed.json()) as { commands: unknown[] }).commands.length,
        1,
      );

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
