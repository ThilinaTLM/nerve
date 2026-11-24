import assert from "node:assert/strict";
import test from "node:test";
import { McpSecrets } from "./mcp-secrets.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";

void test("deleting a project removes its secrets only", async () => {
  const values = new Map([
    ["mcp:project:proj_1:a", "1"],
    ["mcp:project:proj_1:b", "2"],
    ["mcp:project:proj_10:a", "3"],
    ["mcp:user:a", "4"],
  ]);
  const vault: SecretProvider = {
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
    list: async () => [...values.keys()],
  };
  await new McpSecrets(vault).deleteProject("proj_1");
  assert.deepEqual([...values.keys()], ["mcp:project:proj_10:a", "mcp:user:a"]);
});
